import type { IntegrationSettings } from "@prisma/client";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
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
    databaseConfigured: isDatabaseConfigured(),
    organization: null,
  };
}

export async function getSettings(userId: string) {
  const prisma = getPrisma();
  return prisma.integrationSettings.upsert({
    where: { userId },
    create: {
      userId,
      apiBaseUrl: DEFAULT_BASE_URL,
    },
    update: {},
  });
}

export async function getDecryptedApiKey(userId: string) {
  const settings = await getSettings(userId);
  if (!settings.encryptedApiKey) return null;
  return decryptSecret(settings.encryptedApiKey);
}

export function publicSettings(
  settings: IntegrationSettings,
  organization: ServiceMinderOrganizationIdentity | null = null,
): PublicSettings {
  return {
    apiBaseUrl: settings.apiBaseUrl,
    apiKeyConfigured: Boolean(settings.encryptedApiKey),
    apiKeyHint: settings.apiKeyHint,
    includeContactDefault: settings.includeContactDefault,
    excludedServiceNames: parseExcludedServiceNames(settings.excludedServiceNames),
    connectionStatus: settings.connectionStatus,
    lastSuccessfulSync: settings.lastSuccessfulSync?.toISOString() ?? null,
    lastError: settings.lastError,
    databaseConfigured: true,
    organization,
  };
}
