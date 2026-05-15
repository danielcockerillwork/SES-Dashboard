import { NextResponse } from "next/server";
import { requireCurrentUserId, unauthorizedResponse } from "@/lib/auth";
import { getDecryptedApiKey, getSettings } from "@/lib/settings";
import { ServiceMinderClient } from "@/lib/serviceminder/client";
import { serviceCatalogFromResponse } from "@/lib/serviceminder/reporting";

export const runtime = "nodejs";

export async function GET() {
  const userId = await requireCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const [settings, apiKey] = await Promise.all([getSettings(userId), getDecryptedApiKey(userId)]);
  if (!apiKey) {
    return NextResponse.json(
      { services: [], error: "Save a ServiceMinder API key before loading services." },
      { status: 400 },
    );
  }

  try {
    const client = new ServiceMinderClient({
      baseUrl: settings.apiBaseUrl,
      apiKey,
    });
    const servicesResponse = await client.services({ includeInactive: true });
    const services = serviceCatalogFromResponse(servicesResponse);

    if (!services.length) {
      return NextResponse.json({
        services: [],
        error: "ServiceMinder returned no services for this organization.",
      });
    }

    return NextResponse.json({ services });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ServiceMinder services could not be loaded.";
    return NextResponse.json({ services: [], error: message }, { status: 502 });
  }
}
