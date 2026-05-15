import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import { requireCurrentUserId, unauthorizedResponse } from "@/lib/auth";
import {
  DEFAULT_BASE_URL,
  fallbackPublicSettings,
  getSettings,
  parseExcludedServiceNames,
  publicSettings,
} from "@/lib/settings";
import { apiKeyHint, decryptSecret, encryptSecret } from "@/lib/security";
import { ServiceMinderClient } from "@/lib/serviceminder/client";
import { resolveCurrentServiceMinderOrganization } from "@/lib/serviceminder/identity";

export const runtime = "nodejs";

const settingsSchema = z.object({
  apiBaseUrl: z.string().url().default(DEFAULT_BASE_URL),
  apiKey: z.string().optional().or(z.literal("")),
  includeContactDefault: z.boolean().default(true),
  excludedServiceNames: z.array(z.string()).default([]),
});

function isFormRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
}

function formValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : undefined;
}

async function readSettingsInput(request: Request) {
  if (isFormRequest(request)) {
    const formData = await request.formData();
    const includeContactDefault = formValue(formData.get("includeContactDefault"));
    const excludedServiceNames = formData
      .getAll("excludedServiceNames")
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);
    return {
      apiBaseUrl: formValue(formData.get("apiBaseUrl")) ?? DEFAULT_BASE_URL,
      apiKey: formValue(formData.get("apiKey")) ?? "",
      includeContactDefault: includeContactDefault === undefined ? true : includeContactDefault === "true",
      excludedServiceNames,
    };
  }

  return request.json().catch(() => null);
}

function settingsValidationError() {
  return NextResponse.json(
    { error: "Enter a valid API base URL before saving settings." },
    { status: 400 },
  );
}

function redirectToSettings(request: Request, status: "saved" | "invalid" | "error") {
  const url = new URL("/settings", request.url);
  url.searchParams.set("settings", status);
  return NextResponse.redirect(url, { status: 303 });
}

async function resolveOrganizationForSettings(settings: Awaited<ReturnType<typeof getSettings>>) {
  if (!settings.encryptedApiKey) return null;
  try {
    const client = new ServiceMinderClient({
      baseUrl: settings.apiBaseUrl,
      apiKey: decryptSecret(settings.encryptedApiKey),
    });
    return await resolveCurrentServiceMinderOrganization(client);
  } catch {
    return null;
  }
}

export async function GET() {
  const userId = await requireCurrentUserId();
  if (!userId) return unauthorizedResponse();

  if (!isDatabaseConfigured()) {
    return NextResponse.json(fallbackPublicSettings("DATABASE_URL is required to save user-level API settings."));
  }

  const settings = await getSettings(userId);
  const organization = await resolveOrganizationForSettings(settings);
  return NextResponse.json(publicSettings(settings, organization));
}

export async function POST(request: Request) {
  const userId = await requireCurrentUserId();
  if (!userId) return unauthorizedResponse();

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      fallbackPublicSettings("DATABASE_URL is required before settings can be saved."),
      { status: 503 },
    );
  }

  const formRequest = isFormRequest(request);
  const parsed = settingsSchema.safeParse(await readSettingsInput(request));
  if (!parsed.success) return formRequest ? redirectToSettings(request, "invalid") : settingsValidationError();

  const input = parsed.data;
  const apiKey = input.apiKey?.trim() ?? "";

  try {
    const data = {
      apiBaseUrl: input.apiBaseUrl.replace(/\/$/, ""),
      includeContactDefault: input.includeContactDefault,
      excludedServiceNames: parseExcludedServiceNames(input.excludedServiceNames),
      ...(apiKey
        ? {
            encryptedApiKey: encryptSecret(apiKey),
            apiKeyHint: apiKeyHint(apiKey),
            connectionStatus: "configured",
            lastError: null,
          }
        : {}),
    };

    const settings = await getPrisma().integrationSettings.upsert({
      where: { userId },
      create: {
        userId,
        ...data,
      },
      update: data,
    });

    const organization = await resolveOrganizationForSettings(settings);
    return formRequest ? redirectToSettings(request, "saved") : NextResponse.json(publicSettings(settings, organization));
  } catch {
    return formRequest ? redirectToSettings(request, "error") : NextResponse.json(
      { error: "Settings could not be saved. Check the database and encryption configuration." },
      { status: 500 },
    );
  }
}
