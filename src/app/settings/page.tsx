import { SettingsClient } from "@/app/settings/settings-client";
import { requireCurrentUserId } from "@/lib/auth";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import { decryptSecret } from "@/lib/security";
import {
  DEFAULT_BASE_URL,
  fallbackPublicSettings,
  getSettings,
  publicSettings,
  type PublicSettings,
} from "@/lib/settings";
import { ServiceMinderClient } from "@/lib/serviceminder/client";
import { resolveCurrentServiceMinderOrganization } from "@/lib/serviceminder/identity";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  searchParams: Promise<{ settings?: string | string[] }>;
};

function noticeFromSettingsStatus(status: string | string[] | undefined) {
  const value = Array.isArray(status) ? status[0] : status;
  if (value === "saved") return "Settings saved.";
  if (value === "invalid") return "Enter a valid API base URL before saving settings.";
  if (value === "error") return "Settings could not be saved. Check the database and encryption configuration.";
  return null;
}

async function loadInitialSettings(): Promise<PublicSettings> {
  const userId = await requireCurrentUserId();
  if (!userId) {
    return fallbackPublicSettings("Sign in is required before settings can be loaded.");
  }

  if (!isDatabaseConfigured()) {
    return fallbackPublicSettings("DATABASE_URL is required to save user-level API settings.");
  }

  try {
    await getPrisma().$queryRaw`SELECT 1`;
    const settings = await getSettings(userId);
    if (!settings.encryptedApiKey) return publicSettings(settings);

    try {
      const client = new ServiceMinderClient({
        baseUrl: settings.apiBaseUrl || DEFAULT_BASE_URL,
        apiKey: decryptSecret(settings.encryptedApiKey),
      });
      const organization = await resolveCurrentServiceMinderOrganization(client);
      return publicSettings(settings, organization);
    } catch {
      return publicSettings(settings);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Settings could not be loaded.";
    return fallbackPublicSettings(message);
  }
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const [initialSettings, params] = await Promise.all([loadInitialSettings(), searchParams]);
  return (
    <SettingsClient
      initialSettings={initialSettings}
      initialNotice={noticeFromSettingsStatus(params.settings)}
    />
  );
}
