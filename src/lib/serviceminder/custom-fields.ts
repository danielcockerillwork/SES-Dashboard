import { isRecord, readField, type RawRecord } from "@/lib/serviceminder/field-access";
import type { CustomFieldScoreSummary, CustomFieldValue, CustomFieldValueType } from "@/lib/serviceminder/types";

const FIELD_NAME_KEYS = [
  "Name",
  "Label",
  "FieldName",
  "Field",
  "Key",
  "Question",
  "Prompt",
  "Title",
  "Caption",
  "DisplayName",
  "Shortcode",
];

const FIELD_VALUE_KEYS = [
  "Value",
  "Answer",
  "Response",
  "Score",
  "Rating",
  "Text",
  "TextValue",
  "NumberValue",
  "DecimalValue",
  "Decimal",
  "Amount",
  "CurrencyValue",
  "MoneyValue",
  "CurrentValue",
  "TotalValue",
  "CashValue",
  "ValueText",
  "ValueString",
  "Money",
  "NumericValue",
  "ValueAmount",
  "ValueDecimal",
  "ValueNumber",
  "BoolValue",
  "BooleanValue",
  "SelectedValue",
  "SelectedOption",
  "Option",
  "DisplayValue",
];

const FIELD_KEY_KEYS = ["Shortcode", "ShortCode", "Code", "Key", "FieldName", "Name"];

const CONTAINER_KEY_PATTERN = /(custom.*(field|propert(?:y|ies)|value)|field.*value|appointment.*field|answer|survey|scorecard|checklist)/i;
const DIRECT_CUSTOM_KEY_PATTERN = /^(custom(?!er)(field|score|rating|[_-])|cf_|field_|score_|rating_)/i;
const SCORE_NAME_PATTERN = /(score|rating|nps|satisfaction|quality|grade|stars|points|survey)/i;

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function titleFromKey(key: string) {
  return key
    .replace(/^custom(field)?[_\s-]*/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function valueType(value: unknown): CustomFieldValueType {
  if (value === null || value === undefined || value === "") return "blank";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (typeof value === "string") {
    const date = new Date(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(date.getTime())) return "date";
    return "text";
  }
  return "text";
}

export function displayCustomFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => displayCustomFieldValue(item))
      .filter(Boolean)
      .join(", ");
  }
  if (isRecord(value)) {
    const nested = readField(value, FIELD_VALUE_KEYS);
    if (nested !== undefined) return displayCustomFieldValue(nested);
    return JSON.stringify(value);
  }
  return String(value);
}

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const fraction = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (fraction) {
    const parsed = Number(fraction[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const normalized = trimmed.replace(/[$,% ,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isScoreLike(name: string, numeric: number | null) {
  if (numeric === null) return false;
  if (SCORE_NAME_PATTERN.test(name)) return true;
  return numeric >= 0 && numeric <= 100;
}

function makeField(name: string, value: unknown, sourcePath: string, rawKey: string | null): CustomFieldValue | null {
  const cleanName = name.trim().replace(/\s+/g, " ");
  if (!cleanName) return null;
  const displayValue = displayCustomFieldValue(value);
  const numeric = numericValue(value);

  return {
    name: cleanName,
    normalizedName: normalizeName(cleanName),
    value,
    displayValue,
    valueType: valueType(value),
    numericValue: numeric,
    scoreLike: isScoreLike(cleanName, numeric),
    sourcePath,
    rawKey,
  };
}

function fieldFromRecord(record: RawRecord, sourcePath: string, fallbackName?: string): CustomFieldValue | null {
  const name = displayCustomFieldValue(readField(record, FIELD_NAME_KEYS)) || fallbackName || "";
  const value = readField(record, FIELD_VALUE_KEYS);
  const rawKeyValue = readField(record, FIELD_KEY_KEYS);
  const rawKey =
    typeof rawKeyValue === "string" || typeof rawKeyValue === "number" ? String(rawKeyValue).trim() || null : null;

  if (value !== undefined) return makeField(name, value, sourcePath, rawKey ?? fallbackName ?? null);
  if (fallbackName) return makeField(fallbackName, record, sourcePath, rawKey ?? fallbackName);
  return null;
}

function fieldsFromContainer(container: unknown, sourcePath: string): CustomFieldValue[] {
  if (Array.isArray(container)) {
    return container
      .flatMap((item, index) => {
        if (!isRecord(item)) return [];
        const field = fieldFromRecord(item, `${sourcePath}[${index}]`);
        return field ? [field] : fieldsFromContainer(item, `${sourcePath}[${index}]`);
      })
      .filter(Boolean);
  }

  if (!isRecord(container)) return [];

  const fields: Array<CustomFieldValue | null> = [];
  for (const [key, value] of Object.entries(container)) {
    if (value === undefined) continue;
    if (isRecord(value)) {
      const field = fieldFromRecord(value, `${sourcePath}.${key}`, titleFromKey(key));
      if (field) fields.push(field);
      continue;
    }
    fields.push(makeField(titleFromKey(key), value, `${sourcePath}.${key}`, key));
  }
  return fields.filter((field): field is CustomFieldValue => Boolean(field));
}

function collectContainers(source: unknown, path = "", depth = 0): Array<{ path: string; value: unknown }> {
  if (!isRecord(source) || depth > 3) return [];

  const containers: Array<{ path: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(source)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (CONTAINER_KEY_PATTERN.test(key) && (Array.isArray(value) || isRecord(value))) {
      containers.push({ path: nextPath, value });
      continue;
    }
    if (isRecord(value) || Array.isArray(value)) {
      containers.push(...collectContainers(value, nextPath, depth + 1));
    }
  }

  return containers;
}

export function extractCustomFields(raw: RawRecord): CustomFieldValue[] {
  const fields: CustomFieldValue[] = [];
  const seen = new Set<string>();

  for (const { path, value } of collectContainers(raw)) {
    for (const field of fieldsFromContainer(value, path)) {
      const key = `${field.normalizedName}:${field.sourcePath}:${field.displayValue}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fields.push(field);
    }
  }

  for (const [key, value] of Object.entries(raw)) {
    if (!DIRECT_CUSTOM_KEY_PATTERN.test(key) || Array.isArray(value) || isRecord(value)) continue;
    const field = makeField(titleFromKey(key), value, key, key);
    if (!field) continue;
    const dedupeKey = `${field.normalizedName}:${field.sourcePath}:${field.displayValue}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      fields.push(field);
    }
  }

  return fields.sort((left, right) => left.name.localeCompare(right.name));
}

export function summarizeFieldValues(totalRows: number, fields: CustomFieldValue[]): CustomFieldScoreSummary[] {
  const byName = new Map<string, CustomFieldValue[]>();
  const displayName = new Map<string, string>();

  for (const field of fields) {
    const current = byName.get(field.normalizedName) ?? [];
    current.push(field);
    byName.set(field.normalizedName, current);
    displayName.set(field.normalizedName, field.name);
  }

  return Array.from(byName.entries())
    .map(([normalizedName, values]) => {
      const valueTypes: Record<string, number> = {};
      const valueCounts = new Map<string, number>();
      const examples: string[] = [];
      const numericValues = values
        .map((field) => field.numericValue)
        .filter((value): value is number => value !== null);

      for (const field of values) {
        valueTypes[field.valueType] = (valueTypes[field.valueType] ?? 0) + 1;
        const display = field.displayValue || "(blank)";
        valueCounts.set(display, (valueCounts.get(display) ?? 0) + 1);
        if (examples.length < 3 && field.displayValue) examples.push(field.displayValue);
      }

      const count = values.length;
      return {
        name: displayName.get(normalizedName) ?? normalizedName,
        normalizedName,
        count,
        missingCount: Math.max(0, totalRows - count),
        coverageRate: totalRows ? (count / totalRows) * 100 : 0,
        valueTypes,
        scoreLike: values.some((field) => field.scoreLike),
        numericCount: numericValues.length,
        average: numericValues.length ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length : null,
        min: numericValues.length ? Math.min(...numericValues) : null,
        max: numericValues.length ? Math.max(...numericValues) : null,
        topValues: Array.from(valueCounts.entries())
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .slice(0, 5)
          .map(([value, countValue]) => ({ value, count: countValue })),
        examples,
      };
    })
    .sort((left, right) => {
      if (right.scoreLike !== left.scoreLike) return Number(right.scoreLike) - Number(left.scoreLike);
      return right.count - left.count || left.name.localeCompare(right.name);
    });
}

export function customFieldLookup(fields: CustomFieldValue[]) {
  const byName = new Map<string, CustomFieldValue>();
  for (const field of fields) {
    if (!byName.has(field.normalizedName)) byName.set(field.normalizedName, field);
  }
  return byName;
}
