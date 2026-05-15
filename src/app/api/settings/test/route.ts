import { NextResponse } from "next/server";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import { requireCurrentUserId, unauthorizedResponse } from "@/lib/auth";
import { fallbackPublicSettings, getDecryptedApiKey, getSettings, publicSettings } from "@/lib/settings";
import { ServiceMinderApiError, ServiceMinderClient } from "@/lib/serviceminder/client";
import { resolveCurrentServiceMinderOrganization } from "@/lib/serviceminder/identity";

export const runtime = "nodejs";

export async function POST() {
  const userId = await requireCurrentUserId();
  if (!userId) return unauthorizedResponse();

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      fallbackPublicSettings("DATABASE_URL is required before the connection can be tested."),
      { status: 503 },
    );
  }

  const settings = await getSettings(userId);
  const apiKey = await getDecryptedApiKey(userId);

  if (!apiKey) {
    const updated = await getPrisma().integrationSettings.update({
      where: { userId },
      data: {
        connectionStatus: "error",
        lastError: "API key is required before testing the connection.",
      },
    });
    return NextResponse.json(publicSettings(updated), { status: 400 });
  }

  try {
    const client = new ServiceMinderClient({
      baseUrl: settings.apiBaseUrl,
      apiKey,
    });
    await client.echo();
    const organization = await resolveCurrentServiceMinderOrganization(client);
    const updated = await getPrisma().integrationSettings.update({
      where: { userId },
      data: {
        connectionStatus: "connected",
        lastSuccessfulSync: new Date(),
        lastError: null,
      },
    });
    return NextResponse.json(publicSettings(updated, organization));
  } catch (error) {
    const message =
      error instanceof ServiceMinderApiError
        ? `${error.message}${error.resultCode !== null ? ` (ResultCode ${error.resultCode})` : ""}`
        : error instanceof Error
          ? error.message
          : "Unknown ServiceMinder error.";
    const updated = await getPrisma().integrationSettings.update({
      where: { userId },
      data: {
        connectionStatus: "error",
        lastError: message,
      },
    });
    return NextResponse.json(publicSettings(updated), { status: 502 });
  }
}
