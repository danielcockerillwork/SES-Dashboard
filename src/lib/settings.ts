import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import { getLocalSettings, saveLocalSettings, type LocalIntegrationSettings } from "@/lib/local-store";
import { isDesktopMode } from "@/lib/runtime";
import { decryptSecret } from "@/lib/security";
import type { ServiceMinderOrganizationIdentity } from "@/lib/serviceminder/identity";

export const DEFAULT_BASE_URL =
  process.env.SERVICEMINDER_DEFAULT_BASE_URL ?? "https://serviceminder.com/api";

export function parseExcludedServiceNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item): item is string => item.length > 0),
    ),
  ];
}

export type PublicSettings = {
  apiBaseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyHint: string | null;
  includeContactDefault: boolean;
  excludedServiceNames: string[];
  connectionStatus: string;
  lastSuccessfulSync: string | null;
  lastError: string | null;
  databaseConfigured: boolean;
  organization: ServiceMinderOrganizationIdentity | null;
  localStorage: boolean;
};

export type DashboardSettings = Omit<LocalIntegrationSettings, "excludedServiceNames" | "lastSuccessfulSync" | "createdAt" | "updatedAt"> & {
  excludedServiceNames: unknown;
  lastSuccessfulSync: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export function fallbackPublicSettings(lastError: string | null = null): PublicSettings {
  return {
    apiBaseUrl: DEFAULT_BASE_URL,
    apiKeyConfigured: false,
    apiKeyHint: null,
    includeContactDefault: true,
    excludedServiceNames: [],
    connectionStatus: isDatabaseConfigured() ? "not_configured" : "database_not_configured",
    lastSuccessfulSync: null,
    lastError,
    databaseConfigured: isDesktopMode() || isDatabaseConfigured(),
    organization: null,
    localStorage: isDesktopMode(),
  };
}

export async function getSettings(userId: string): Promise<DashboardSettings> {
  if (isDesktopMode()) return getLocalSettings(userId);

  const prisma = getPrisma();
  return prisma.integrationSettings.upsert({
    where: { userId },
    create: {
      userId,
      apiBaseUrl: DEFAULT_BASE_URL,
    },
    update: {},
  }) as Promise<DashboardSettings>;
}

export async function getDecryptedApiKey(userId: string) {
  const settings = await getSettings(userId);
  if (!settings.encryptedApiKey) return null;
  return decryptSecret(settings.encryptedApiKey);
}

export function publicSettings(
  settings: DashboardSettings,
  organization: ServiceMinderOrganizationIdentity | null = null,
): PublicSettings {
  return {
    apiBaseUrl: settings.apiBaseUrl,
    apiKeyConfigured: Boolean(settings.encryptedApiKey),
    apiKeyHint: settings.apiKeyHint,
    includeContactDefault: settings.includeContactDefault,
    excludedServiceNames: parseExcludedServiceNames(settings.excludedServiceNames),
    connectionStatus: settings.connectionStatus,
    lastSuccessfulSync:
      settings.lastSuccessfulSync instanceof Date
        ? settings.lastSuccessfulSync.toISOString()
        : settings.lastSuccessfulSync ?? null,
    lastError: settings.lastError,
    databaseConfigured: true,
    organization,
    localStorage: isDesktopMode(),
  };
}

export async function saveSettings(userId: string, data: Partial<DashboardSettings>) {
  if (isDesktopMode()) return saveLocalSettings(userId, normalizeLocalSettingsInput(data));
  const prismaData = prismaSettingsInput(data);

  return getPrisma().integrationSettings.upsert({
    where: { userId },
    create: {
      userId,
      apiBaseUrl: DEFAULT_BASE_URL,
      ...prismaData,
    },
    update: prismaData,
  }) as Promise<DashboardSettings>;
}

export async function updateSettings(userId: string, data: Partial<DashboardSettings>) {
  if (isDesktopMode()) return saveLocalSettings(userId, normalizeLocalSettingsInput(data));

  return getPrisma().integrationSettings.update({
    where: { userId },
    data: prismaSettingsInput(data),
  }) as Promise<DashboardSettings>;
}

function normalizeLocalSettingsInput(data: Partial<DashboardSettings>): Partial<LocalIntegrationSettings> {
  const normalized: Partial<LocalIntegrationSettings> = {};
  if (data.apiBaseUrl !== undefined) normalized.apiBaseUrl = data.apiBaseUrl;
  if (data.encryptedApiKey !== undefined) normalized.encryptedApiKey = data.encryptedApiKey;
  if (data.apiKeyHint !== undefined) normalized.apiKeyHint = data.apiKeyHint;
  if (data.includeContactDefault !== undefined) normalized.includeContactDefault = data.includeContactDefault;
  if (data.connectionStatus !== undefined) normalized.connectionStatus = data.connectionStatus;
  if (data.lastError !== undefined) normalized.lastError = data.lastError;
  if (data.lastSuccessfulSync !== undefined) {
    normalized.lastSuccessfulSync =
      data.lastSuccessfulSync instanceof Date ? data.lastSuccessfulSync.toISOString() : data.lastSuccessfulSync;
  }
  if (data.createdAt !== undefined) normalized.createdAt = data.createdAt instanceof Date ? data.createdAt.toISOString() : data.createdAt;
  if (data.updatedAt !== undefined) normalized.updatedAt = data.updatedAt instanceof Date ? data.updatedAt.toISOString() : data.updatedAt;
  if ("excludedServiceNames" in data) {
    normalized.excludedServiceNames = Array.isArray(data.excludedServiceNames)
      ? data.excludedServiceNames.filter((item): item is string => typeof item === "string")
      : [];
  }
  return normalized;
}

function prismaSettingsInput(data: Partial<DashboardSettings>) {
  const normalized = normalizeLocalSettingsInput(data);
  return {
    ...(normalized.apiBaseUrl !== undefined ? { apiBaseUrl: normalized.apiBaseUrl } : {}),
    ...(normalized.encryptedApiKey !== undefined ? { encryptedApiKey: normalized.encryptedApiKey } : {}),
    ...(normalized.apiKeyHint !== undefined ? { apiKeyHint: normalized.apiKeyHint } : {}),
    ...(normalized.includeContactDefault !== undefined ? { includeContactDefault: normalized.includeContactDefault } : {}),
    ...(normalized.excludedServiceNames !== undefined ? { excludedServiceNames: normalized.excludedServiceNames } : {}),
    ...(normalized.connectionStatus !== undefined ? { connectionStatus: normalized.connectionStatus } : {}),
    ...(normalized.lastSuccessfulSync !== undefined ? { lastSuccessfulSync: normalized.lastSuccessfulSync } : {}),
    ...(normalized.lastError !== undefined ? { lastError: normalized.lastError } : {}),
  };
}
