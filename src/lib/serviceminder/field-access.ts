export type RawRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readField(source: unknown, candidates: string[]): unknown {
  if (!isRecord(source)) return undefined;

  for (const candidate of candidates) {
    const parts = candidate.split(".");
    let value: unknown = source;
    for (const part of parts) {
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

export function firstArray(source: unknown, candidates: string[]) {
  const direct = Array.isArray(source) ? source : undefined;
  if (direct) return direct;

  for (const candidate of candidates) {
    const value = readField(source, [candidate]);
    if (Array.isArray(value)) return value;
  }

  return [];
}

export function stringField(source: unknown, candidates: string[]) {
  const value = readField(source, candidates);
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

export function numberField(source: unknown, candidates: string[]) {
  const value = readField(source, candidates);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[$,% ,]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function booleanField(source: unknown, candidates: string[]) {
  const value = readField(source, candidates);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return null;
  const lowered = value.trim().toLowerCase();
  if (["true", "yes", "y", "complete", "completed", "done"].includes(lowered)) return true;
  if (["false", "no", "n", "incomplete", "open", "scheduled"].includes(lowered)) return false;
  return null;
}

export function dateField(source: unknown, candidates: string[]) {
  const value = stringField(source, candidates);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
