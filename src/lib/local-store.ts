import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const STORE_VERSION = 1;
const DEFAULT_BASE_URL = "https://serviceminder.com/api";

export type LocalIntegrationSettings = {
  id: number;
  userId: string;
  apiBaseUrl: string;
  encryptedApiKey: string | null;
  apiKeyHint: string | null;
  includeContactDefault: boolean;
  excludedServiceNames: string[];
  connectionStatus: string;
  lastSuccessfulSync: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LocalSavedReportView = {
  id: string;
  userId: string;
  reportType: string;
  name: string;
  filters: Record<string, unknown>;
  columns: string[];
  sorting: unknown | null;
  createdAt: string;
  updatedAt: string;
};

type SettingsFile = {
  version: number;
  settings: LocalIntegrationSettings;
};

type SavedViewsFile = {
  version: number;
  views: LocalSavedReportView[];
};

function nowIso() {
  return new Date().toISOString();
}

export function localDataDir() {
  return process.env.SES_DASHBOARD_DATA_DIR ?? path.join(process.cwd(), ".desktop-data");
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

function settingsPath() {
  return path.join(localDataDir(), "settings.json");
}

function savedViewsPath() {
  return path.join(localDataDir(), "saved-views.json");
}

function reportRunPath(id: string) {
  return path.join(localDataDir(), "report-runs", `${id}.json`);
}

function defaultSettings(userId: string): LocalIntegrationSettings {
  const timestamp = nowIso();
  return {
    id: 1,
    userId,
    apiBaseUrl: process.env.SERVICEMINDER_DEFAULT_BASE_URL ?? DEFAULT_BASE_URL,
    encryptedApiKey: null,
    apiKeyHint: null,
    includeContactDefault: true,
    excludedServiceNames: [],
    connectionStatus: "not_configured",
    lastSuccessfulSync: null,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function getLocalEncryptionKey() {
  const keyPath = path.join(localDataDir(), "encryption.key");
  const existing = await readJsonFile<{ key?: unknown }>(keyPath);
  if (typeof existing?.key === "string" && existing.key.length >= 32) return existing.key;

  const key = crypto.randomBytes(32).toString("base64url");
  await writeJsonFile(keyPath, { version: STORE_VERSION, createdAt: nowIso(), key });
  try {
    await fs.chmod(keyPath, 0o600);
  } catch {
    // Best effort only; chmod can fail on some mounted drives.
  }
  return key;
}

export async function getLocalSettings(userId: string) {
  const file = await readJsonFile<SettingsFile>(settingsPath());
  if (file?.settings?.userId === userId) return normalizeSettings(file.settings, userId);

  const settings = defaultSettings(userId);
  await writeJsonFile(settingsPath(), { version: STORE_VERSION, settings });
  return settings;
}

export async function saveLocalSettings(userId: string, data: Partial<LocalIntegrationSettings>) {
  const current = await getLocalSettings(userId);
  const settings = normalizeSettings(
    {
      ...current,
      ...data,
      userId,
      updatedAt: nowIso(),
    },
    userId,
  );
  await writeJsonFile(settingsPath(), { version: STORE_VERSION, settings });
  return settings;
}

function normalizeSettings(settings: LocalIntegrationSettings, userId: string): LocalIntegrationSettings {
  return {
    ...defaultSettings(userId),
    ...settings,
    userId,
    apiBaseUrl: settings.apiBaseUrl || process.env.SERVICEMINDER_DEFAULT_BASE_URL || DEFAULT_BASE_URL,
    encryptedApiKey: settings.encryptedApiKey ?? null,
    apiKeyHint: settings.apiKeyHint ?? null,
    excludedServiceNames: Array.isArray(settings.excludedServiceNames) ? settings.excludedServiceNames : [],
    lastSuccessfulSync: settings.lastSuccessfulSync ?? null,
    lastError: settings.lastError ?? null,
  };
}

async function readSavedViewsFile(): Promise<SavedViewsFile> {
  return (await readJsonFile<SavedViewsFile>(savedViewsPath())) ?? { version: STORE_VERSION, views: [] };
}

export async function listLocalSavedViews(userId: string, reportType: string) {
  const file = await readSavedViewsFile();
  return file.views
    .filter((view) => view.userId === userId && view.reportType === reportType)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createLocalSavedView(input: {
  userId: string;
  reportType: string;
  name: string;
  filters: Record<string, unknown>;
  columns: string[];
}) {
  const file = await readSavedViewsFile();
  const timestamp = nowIso();
  const view: LocalSavedReportView = {
    id: crypto.randomUUID(),
    userId: input.userId,
    reportType: input.reportType,
    name: input.name,
    filters: input.filters,
    columns: input.columns,
    sorting: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  file.views.unshift(view);
  await writeJsonFile(savedViewsPath(), file);
  return view;
}

export async function deleteLocalSavedView(userId: string, id: string) {
  const file = await readSavedViewsFile();
  file.views = file.views.filter((view) => !(view.id === id && view.userId === userId));
  await writeJsonFile(savedViewsPath(), file);
}

export async function appendLocalReportRun(input: {
  userId: string;
  reportType: string;
  filters: Record<string, unknown>;
  source: string;
  rowCount: number;
  rawPayload: unknown;
}) {
  const timestamp = nowIso();
  const id = `${timestamp.replace(/[:.]/g, "-")}-${crypto.randomUUID()}`;
  await writeJsonFile(reportRunPath(id), {
    version: STORE_VERSION,
    id,
    createdAt: timestamp,
    ...input,
  });
}
