#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

const throughDate = new Date();
const fromDate = new Date(throughDate);
fromDate.setDate(fromDate.getDate() - 30);

const apiKey =
  process.env.SERVICEMINDER_API_KEY ??
  process.env.SERVICE_MINDER_API_KEY ??
  process.env.CONSERVA_SERVICEMINDER_API_KEY;
const baseUrl = process.env.SERVICEMINDER_DEFAULT_BASE_URL ?? "https://serviceminder.com/api";
const from = argValue("--from", process.env.SERVICEMINDER_EXPLORE_FROM ?? isoDate(fromDate));
const through = argValue("--through", process.env.SERVICEMINDER_EXPLORE_THROUGH ?? isoDate(throughDate));
const take = Number(argValue("--take", "100"));
const maxRecords = Number(argValue("--max-records", process.env.SERVICEMINDER_MAX_RECORDS ?? "5000"));

if (!apiKey) {
  console.error("Missing SERVICEMINDER_API_KEY. Set it in the shell or .env.local before running exploration.");
  process.exit(1);
}

function endpointUrl(endpoint) {
  return `${baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readField(source, candidates) {
  if (!isRecord(source)) return undefined;
  for (const candidate of candidates) {
    let value = source;
    for (const part of candidate.split(".")) {
      if (!isRecord(value)) {
        value = undefined;
        break;
      }
      if (part in value) {
        value = value[part];
        continue;
      }
      const matchedKey = Object.keys(value).find((key) => key.toLowerCase() === part.toLowerCase());
      if (!matchedKey) {
        value = undefined;
        break;
      }
      value = value[matchedKey];
    }
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function display(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(display).filter(Boolean).join(", ");
  if (isRecord(value)) {
    const nested = readField(value, [
      "Value",
      "Answer",
      "Response",
      "Score",
      "Rating",
      "Text",
      "DisplayValue",
      "SelectedOption",
    ]);
    if (nested !== undefined) return display(nested);
    return JSON.stringify(value);
  }
  return String(value);
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const fraction = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (fraction) return Number(fraction[1]);
  const normalized = trimmed.replace(/[$,% ,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueType(value) {
  if (value === null || value === undefined || value === "") return "blank";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  return "text";
}

function titleFromKey(key) {
  return key
    .replace(/^custom(field)?[_\s-]*/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

const fieldNameKeys = ["Name", "Label", "FieldName", "Field", "Key", "Question", "Prompt", "Title", "DisplayName"];
const fieldValueKeys = ["Value", "Answer", "Response", "Score", "Rating", "Text", "TextValue", "NumberValue", "DisplayValue", "SelectedOption"];
const containerPattern = /(custom.*field|field.*value|appointment.*field|answer|survey|scorecard|checklist)/i;
const directCustomPattern = /^(custom(?!er)(field|score|rating|[_-])|cf_|field_|score_|rating_)/i;
const scoreNamePattern = /(score|rating|nps|satisfaction|quality|grade|stars|points|survey)/i;
const sesScoreCandidates = [
  "contact.cust_sesscore",
  "Contact.cust_sesscore",
  "Contact.Cust_SESScore",
  "Contact.cust_SESScore",
  "Contact.Cust_SESScore.Value",
  "Contact.CustomFields.cust_sesscore",
  "cust_sesscore",
  "Cust_SESScore",
  "cust_SESScore",
];

function fieldFromRecord(record, pathName, fallbackName = "") {
  const name = display(readField(record, fieldNameKeys)) || fallbackName;
  const value = readField(record, fieldValueKeys);
  if (!name || value === undefined) return null;
  const numeric = numericValue(value);
  return {
    name,
    normalizedName: name.trim().replace(/\s+/g, " ").toLowerCase(),
    displayValue: display(value),
    valueType: valueType(value),
    numericValue: numeric,
    scoreLike: numeric !== null && (scoreNamePattern.test(name) || (numeric >= 0 && numeric <= 100)),
    sourcePath: pathName,
  };
}

function fieldsFromContainer(container, sourcePath) {
  if (Array.isArray(container)) {
    return container.flatMap((item, index) => (isRecord(item) ? [fieldFromRecord(item, `${sourcePath}[${index}]`)].filter(Boolean) : []));
  }
  if (!isRecord(container)) return [];
  return Object.entries(container)
    .map(([key, value]) => {
      if (isRecord(value)) return fieldFromRecord(value, `${sourcePath}.${key}`, titleFromKey(key));
      return {
        name: titleFromKey(key),
        normalizedName: titleFromKey(key).toLowerCase(),
        displayValue: display(value),
        valueType: valueType(value),
        numericValue: numericValue(value),
        scoreLike: numericValue(value) !== null && (scoreNamePattern.test(key) || numericValue(value) <= 100),
        sourcePath: `${sourcePath}.${key}`,
      };
    })
    .filter(Boolean);
}

function collectContainers(source, sourcePath = "", depth = 0) {
  if (!isRecord(source) || depth > 3) return [];
  const containers = [];
  for (const [key, value] of Object.entries(source)) {
    const nextPath = sourcePath ? `${sourcePath}.${key}` : key;
    if (containerPattern.test(key) && (Array.isArray(value) || isRecord(value))) {
      containers.push({ path: nextPath, value });
      continue;
    }
    if (isRecord(value) || Array.isArray(value)) containers.push(...collectContainers(value, nextPath, depth + 1));
  }
  return containers;
}

function extractCustomFields(appointment) {
  const fields = collectContainers(appointment)
    .flatMap(({ path: sourcePath, value }) => fieldsFromContainer(value, sourcePath))
    .filter((field) => field.name);

  for (const [key, value] of Object.entries(appointment)) {
    if (!directCustomPattern.test(key) || Array.isArray(value) || isRecord(value)) continue;
    const name = titleFromKey(key);
    const numeric = numericValue(value);
    fields.push({
      name,
      normalizedName: name.toLowerCase(),
      displayValue: display(value),
      valueType: valueType(value),
      numericValue: numeric,
      scoreLike: numeric !== null && (scoreNamePattern.test(name) || (numeric >= 0 && numeric <= 100)),
      sourcePath: key,
    });
  }

  return fields;
}

function primarySesScore(appointment) {
  const value = readField(appointment, sesScoreCandidates);
  if (value === undefined || value === null || value === "") return null;
  return {
    sourcePath: "contact.cust_sesscore",
    displayValue: display(value),
    valueType: valueType(value),
    numericValue: numericValue(value),
  };
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (["apikey", "authorization", "token", "secret", "password"].includes(normalized)) return [key, "[REDACTED]"];
      return [key, redact(nested)];
    }),
  );
}

async function post(endpoint, payload) {
  const response = await fetch(endpointUrl(endpoint), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ ...payload, ApiKey: apiKey }),
  });
  const parsed = await response.json();
  if (!response.ok || (typeof parsed.ResultCode === "number" && parsed.ResultCode !== 0)) {
    throw new Error(`ServiceMinder request failed: ${parsed.Message ?? response.statusText}`);
  }
  return parsed;
}

async function queryAppointments() {
  const items = [];
  const rawResponses = [];
  let skip = 0;
  let totalCount = null;

  while (items.length < maxRecords) {
    const response = await post("appointments/query", {
      FromDate: from,
      ThroughDate: through,
      IncludeContact: true,
      IncludeCompleted: true,
      Skip: skip,
      Take: take,
    });
    rawResponses.push(redact(response));
    totalCount = response.Count ?? response.TotalCount ?? totalCount;
    const page = Array.isArray(response.Appointments) ? response.Appointments : [];
    items.push(...page);
    if (page.length < take) break;
    skip += take;
    if (totalCount !== null && items.length >= totalCount) break;
  }

  return { items: items.slice(0, maxRecords), rawResponses, totalCount };
}

const payload = await queryAppointments();
const fieldInventory = new Map();
const appointmentKeys = new Map();
const containerPaths = new Map();
const sesScores = [];

for (const appointment of payload.items) {
  const sesScore = primarySesScore(appointment);
  if (sesScore) sesScores.push(sesScore);
  for (const key of Object.keys(appointment)) {
    appointmentKeys.set(key, (appointmentKeys.get(key) ?? 0) + 1);
  }
  for (const container of collectContainers(appointment)) {
    containerPaths.set(container.path, (containerPaths.get(container.path) ?? 0) + 1);
  }
  for (const field of extractCustomFields(appointment)) {
    const current = fieldInventory.get(field.normalizedName) ?? {
      name: field.name,
      count: 0,
      valueTypes: {},
      numericValues: [],
      scoreLike: false,
      examples: [],
      sourcePaths: new Map(),
    };
    current.count += 1;
    current.valueTypes[field.valueType] = (current.valueTypes[field.valueType] ?? 0) + 1;
    if (field.numericValue !== null) current.numericValues.push(field.numericValue);
    current.scoreLike = current.scoreLike || field.scoreLike;
    if (field.displayValue && current.examples.length < 3) current.examples.push(field.displayValue);
    current.sourcePaths.set(field.sourcePath, (current.sourcePaths.get(field.sourcePath) ?? 0) + 1);
    fieldInventory.set(field.normalizedName, current);
  }
}

const customFields = Array.from(fieldInventory.values())
  .map((field) => ({
    name: field.name,
    count: field.count,
    missingCount: Math.max(0, payload.items.length - field.count),
    coverageRate: payload.items.length ? Number(((field.count / payload.items.length) * 100).toFixed(1)) : 0,
    valueTypes: field.valueTypes,
    scoreLike: field.scoreLike,
    numericCount: field.numericValues.length,
    average: field.numericValues.length ? Number((field.numericValues.reduce((sum, value) => sum + value, 0) / field.numericValues.length).toFixed(2)) : null,
    min: field.numericValues.length ? Math.min(...field.numericValues) : null,
    max: field.numericValues.length ? Math.max(...field.numericValues) : null,
    examples: field.examples,
    sourcePaths: Array.from(field.sourcePaths.entries()).map(([sourcePath, count]) => ({ sourcePath, count })),
  }))
  .sort((left, right) => Number(right.scoreLike) - Number(left.scoreLike) || right.count - left.count || left.name.localeCompare(right.name));
const numericSesScores = sesScores.map((score) => score.numericValue).filter((value) => value !== null);

const result = {
  generatedAt: new Date().toISOString(),
  request: {
    baseUrl,
    endpoint: "appointments/query",
    from,
    through,
    includeContact: true,
    includeCompleted: true,
    take,
    maxRecords,
  },
  totals: {
    returnedAppointments: payload.items.length,
    totalCount: payload.totalCount,
    appointmentsWithSesScore: sesScores.length,
    missingSesScore: Math.max(0, payload.items.length - sesScores.length),
    appointmentsWithCustomFields: payload.items.filter((appointment) => extractCustomFields(appointment).length > 0).length,
  },
  primaryField: {
    name: "SES Score",
    path: "contact.cust_sesscore",
    count: sesScores.length,
    missingCount: Math.max(0, payload.items.length - sesScores.length),
    coverageRate: payload.items.length ? Number(((sesScores.length / payload.items.length) * 100).toFixed(1)) : 0,
    numericCount: numericSesScores.length,
    average: numericSesScores.length ? Number((numericSesScores.reduce((sum, value) => sum + value, 0) / numericSesScores.length).toFixed(2)) : null,
    min: numericSesScores.length ? Math.min(...numericSesScores) : null,
    max: numericSesScores.length ? Math.max(...numericSesScores) : null,
    examples: sesScores.slice(0, 5).map((score) => score.displayValue),
  },
  appointmentKeys: Array.from(appointmentKeys.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count })),
  customFieldContainerPaths: Array.from(containerPaths.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([sourcePath, count]) => ({ sourcePath, count })),
  customFields,
  representativeAppointments: payload.items.slice(0, 3).map(redact),
};

console.log(JSON.stringify(result, null, 2));
