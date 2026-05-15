import { NextResponse } from "next/server";
import { requireCurrentUserId, unauthorizedResponse } from "@/lib/auth";
import { conservaRowsToCsv } from "@/lib/export";
import { getConservaReport } from "@/lib/serviceminder/reporting";
import { defaultDateRange } from "@/lib/utils";
import type { ConservaReportFilters } from "@/lib/serviceminder/types";

export const runtime = "nodejs";

function nullable(value: string | null) {
  return value && value.trim() ? value.trim() : null;
}

function nullableNumber(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function serviceTypesFromRequest(url: URL) {
  const repeated = url.searchParams.getAll("serviceType").map((value) => value.trim()).filter(Boolean);
  const csv = url.searchParams
    .getAll("serviceTypes")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set([...repeated, ...csv]));
}

function filtersFromRequest(request: Request): ConservaReportFilters {
  const url = new URL(request.url);
  const range = defaultDateRange();
  const serviceTypes = serviceTypesFromRequest(url);
  return {
    from: nullable(url.searchParams.get("from")) ?? range.from,
    through: nullable(url.searchParams.get("through")) ?? range.through,
    serviceAgentId: nullable(url.searchParams.get("serviceAgentId")),
    serviceAgentName: nullable(url.searchParams.get("serviceAgentName")),
    serviceType: serviceTypes.length === 1 ? serviceTypes[0] : nullable(url.searchParams.get("serviceType")),
    serviceTypes,
    organization: nullable(url.searchParams.get("organization")),
    missingSesScore:
      url.searchParams.get("missingSesScore") === "true" ||
      url.searchParams.get("missingSelectedField") === "true",
    minScore: nullableNumber(url.searchParams.get("minScore")),
    maxScore: nullableNumber(url.searchParams.get("maxScore")),
    search: nullable(url.searchParams.get("search")),
  };
}

function refreshCacheFromRequest(request: Request) {
  const url = new URL(request.url);
  return url.searchParams.get("refreshCache") === "true";
}

export async function GET(request: Request) {
  const userId = await requireCurrentUserId();
  if (!userId) return unauthorizedResponse();

  const result = await getConservaReport(userId, filtersFromRequest(request), {
    refreshCache: refreshCacheFromRequest(request),
  });
  const csv = conservaRowsToCsv(result.rows);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="conserva-ses-score-report.csv"`,
    },
  });
}
