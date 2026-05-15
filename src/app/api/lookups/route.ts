import { NextResponse } from "next/server";
import { requireCurrentUserId, unauthorizedResponse } from "@/lib/auth";
import { getDecryptedApiKey, getSettings } from "@/lib/settings";
import { ServiceMinderClient } from "@/lib/serviceminder/client";
import {
  getConservaReport,
  lookupOptions,
  lookupOptionsFromServiceMinderResponses,
} from "@/lib/serviceminder/reporting";
import { resolveCurrentServiceMinderOrganization } from "@/lib/serviceminder/identity";
import { relativeDateRange } from "@/lib/utils";

export const runtime = "nodejs";

function lookupTimeoutMs() {
  const parsed = Number(process.env.SERVICEMINDER_LOOKUP_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5_000;
}

function fetchWithTimeout(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function mockLookupOptions(userId: string) {
  const range = relativeDateRange("last-90-days");
  const result = await getConservaReport(userId, {
    from: range.from,
    through: range.through,
  });

  return lookupOptions(result.rows);
}

export async function GET() {
  const userId = await requireCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const [settings, apiKey] = await Promise.all([getSettings(userId), getDecryptedApiKey(userId)]).catch(() => [null, null] as const);
  if (!settings || !apiKey) return NextResponse.json(await mockLookupOptions(userId));

  const client = new ServiceMinderClient({
    baseUrl: settings.apiBaseUrl,
    apiKey,
    fetcher: fetchWithTimeout(lookupTimeoutMs()),
  });
  const [serviceAgentsResponse, servicesResponse, organizationsResponse] = await Promise.all([
    client.serviceAgents().catch(() => null),
    client.services().catch(() => null),
    client.organizations().catch(() => null),
  ]);

  const options = lookupOptionsFromServiceMinderResponses({
    serviceAgentsResponse,
    servicesResponse,
    organizationsResponse,
  });
  const currentOrganization = await resolveCurrentServiceMinderOrganization(client, { organizationsResponse });

  return NextResponse.json({
    ...options,
    currentOrganization,
  });
}
