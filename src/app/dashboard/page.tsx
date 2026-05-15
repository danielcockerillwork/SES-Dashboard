"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Layers,
  LineChart,
  Loader2,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Star,
  Target,
  TrendingDown,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { DateRangeFields } from "@/components/date-range-fields";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  dateRangePresets,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatScore,
  relativeDateRange,
  type DateRangePreset,
} from "@/lib/utils";
import type { PublicSettings } from "@/lib/settings";
import { applyExcludedServicesToReport } from "@/lib/serviceminder/reporting";
import { isExcludedServiceName } from "@/lib/serviceminder/service-exclusions";
import {
  buildSesValueAnalytics,
  LOW_SES_SCORE_THRESHOLD,
  type SesValueAnalytics,
  type SesValueSegment,
} from "@/lib/serviceminder/analytics";
import type {
  ConservaAppointmentRow,
  ConservaReportSummary,
  CustomFieldScoreSummary,
  ScoreTrendPoint,
} from "@/lib/serviceminder/types";

type PublicRow = Omit<ConservaAppointmentRow, "raw">;

type ReportResponse = {
  source: "live" | "mock" | "cache";
  warning: string | null;
  rows: PublicRow[];
  summary: ConservaReportSummary;
  fieldSummaries: CustomFieldScoreSummary[];
  scoreTrends: ScoreTrendPoint[];
  rawPayloads: [];
};

type SavedView = {
  id: string;
  name: string;
  filters: Record<string, unknown>;
};

type LookupOptions = {
  serviceAgents: Array<{ id: string; name: string }>;
  services: Array<{ name: string }>;
  organizations: Array<{ name: string }>;
  currentOrganization: {
    id: string | null;
    name: string | null;
    displayName: string | null;
    source: string;
  } | null;
};

const emptyReport: ReportResponse = {
  source: "mock",
  warning: null,
  rows: [],
  summary: {
    completedAppointments: 0,
    appointmentsWithSesScore: 0,
    sesScoreCoverageRate: 0,
    missingSesScore: 0,
    averageSesScore: null,
    minSesScore: null,
    maxSesScore: null,
    firstAppointments: 0,
    firstAppointmentsWithSesScore: 0,
    firstAppointmentSesScoreCoverageRate: 0,
    totalAppointmentValue: 0,
    appointmentsWithCustomFields: 0,
    customFieldCoverageRate: 0,
    selectedFieldCoverageRate: null,
    selectedFieldMissing: null,
    scoreFieldCount: 0,
    averageScore: null,
    missingAnyCustomField: 0,
  },
  fieldSummaries: [],
  scoreTrends: [],
  rawPayloads: [],
};

const emptyLookupOptions: LookupOptions = {
  serviceAgents: [],
  services: [],
  organizations: [],
  currentOrganization: null,
};

const pageSizeOptions = [25, 50, 100] as const;

type PageSize = (typeof pageSizeOptions)[number];
type DashboardTab = "overview" | "analytics";
type DrilldownMetricKey = "completed" | "hasSesScore" | "averageSesScore" | "firstAppointments" | "firstVisitsWithSes" | "missingSesScore";

type AppointmentColumnFilters = {
  id: string;
  appointmentDate: string;
  service: string;
  hasSesScore: "" | "yes" | "no";
  score: string;
  total: string;
  lifetimeValue: string;
  firstAppointment: "" | "yes" | "no";
  contactVisits: string;
};

const emptyAppointmentColumnFilters: AppointmentColumnFilters = {
  id: "",
  appointmentDate: "",
  service: "",
  hasSesScore: "",
  score: "",
  total: "",
  lifetimeValue: "",
  firstAppointment: "",
  contactVisits: "",
};

const drilldownMetricLabels: Record<DrilldownMetricKey, string> = {
  completed: "Completed appointments",
  hasSesScore: "Has SES score",
  averageSesScore: "Average SES score",
  firstAppointments: "First appointments",
  firstVisitsWithSes: "First visits with SES",
  missingSesScore: "Missing SES score",
};

function selectClassName() {
  return "h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring";
}

function uniqueOptions(rows: PublicRow[], key: "serviceAgentName" | "serviceName" | "organizationName") {
  return Array.from(new Set(rows.map((row) => row[key]).filter((value): value is string => Boolean(value)))).sort();
}

function scoreRangeText(field: CustomFieldScoreSummary) {
  if (field.min === null || field.max === null) return "No numeric scores";
  return `${formatScore(field.min)}-${formatScore(field.max)}`;
}

function filterRecord({
  from,
  through,
  serviceAgentName,
  serviceTypes,
  datePreset,
  organization,
  missingSesScore,
  minScore,
  maxScore,
  search,
}: DashboardFilters) {
  return {
    from,
    through,
    datePreset,
    serviceAgentName,
    serviceTypes,
    organization,
    missingSesScore,
    minScore,
    maxScore,
    search,
  };
}

type DashboardFilters = {
  from: string;
  through: string;
  datePreset: DateRangePreset;
  serviceAgentName: string;
  serviceTypes: string[];
  organization: string;
  missingSesScore: boolean;
  minScore: string;
  maxScore: string;
  search: string;
};

const DEFAULT_DATE_PRESET: DateRangePreset = "last-7-days";
const dashboardStorageKey = "conserva-dashboard-state:v3";

function createDefaultFilters(): DashboardFilters {
  const range = relativeDateRange(DEFAULT_DATE_PRESET);
  return {
    from: range.from,
    through: range.through,
    datePreset: DEFAULT_DATE_PRESET,
    serviceAgentName: "",
    serviceTypes: [],
    organization: "",
    missingSesScore: false,
    minScore: "",
    maxScore: "",
    search: "",
  };
}

function cloneFilters(filters: DashboardFilters): DashboardFilters {
  return {
    ...filters,
    serviceTypes: [...filters.serviceTypes],
  };
}

function filtersEqual(left: DashboardFilters, right: DashboardFilters) {
  return (
    left.from === right.from &&
    left.through === right.through &&
    left.datePreset === right.datePreset &&
    left.serviceAgentName === right.serviceAgentName &&
    left.organization === right.organization &&
    left.missingSesScore === right.missingSesScore &&
    left.minScore === right.minScore &&
    left.maxScore === right.maxScore &&
    left.search === right.search &&
    left.serviceTypes.length === right.serviceTypes.length &&
    left.serviceTypes.every((value, index) => value === right.serviceTypes[index])
  );
}

function isDashboardFilters(value: unknown): value is DashboardFilters {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DashboardFilters>;
  return (
    typeof record.from === "string" &&
    typeof record.through === "string" &&
    isDateRangePreset(record.datePreset) &&
    typeof record.serviceAgentName === "string" &&
    Array.isArray(record.serviceTypes) &&
    record.serviceTypes.every((item) => typeof item === "string") &&
    typeof record.organization === "string" &&
    typeof record.missingSesScore === "boolean" &&
    typeof record.minScore === "string" &&
    typeof record.maxScore === "string" &&
    typeof record.search === "string"
  );
}

function isDateRangePreset(value: unknown): value is DateRangePreset {
  return typeof value === "string" && dateRangePresets.some((preset) => preset.value === value);
}

function paramsFromFilters({
  from,
  through,
  serviceAgentName,
  serviceTypes,
  organization,
  missingSesScore,
  minScore,
  maxScore,
  search,
}: DashboardFilters) {
  const next = new URLSearchParams({ from, through });
  if (serviceAgentName) next.set("serviceAgentName", serviceAgentName);
  for (const serviceType of serviceTypes) next.append("serviceType", serviceType);
  if (organization) next.set("organization", organization);
  if (missingSesScore) next.set("missingSesScore", "true");
  if (minScore) next.set("minScore", minScore);
  if (maxScore) next.set("maxScore", maxScore);
  if (search) next.set("search", search);
  return next;
}

function filtersFromSavedView(view: SavedView, fallback: DashboardFilters): DashboardFilters {
  const filters = view.filters;
  return {
    from: typeof filters.from === "string" ? filters.from : fallback.from,
    through: typeof filters.through === "string" ? filters.through : fallback.through,
    datePreset: isDateRangePreset(filters.datePreset) ? filters.datePreset : "custom",
    serviceAgentName: typeof filters.serviceAgentName === "string" ? filters.serviceAgentName : "",
    serviceTypes: arrayFromFilter(filters.serviceTypes ?? filters.serviceType),
    organization: typeof filters.organization === "string" ? filters.organization : "",
    missingSesScore: Boolean(filters.missingSesScore ?? filters.missingSelectedField),
    minScore: typeof filters.minScore === "string" ? filters.minScore : "",
    maxScore: typeof filters.maxScore === "string" ? filters.maxScore : "",
    search: typeof filters.search === "string" ? filters.search : "",
  };
}

function arrayFromFilter(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item));
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function normalizeLookupOptions(value: unknown): LookupOptions {
  if (!value || typeof value !== "object") return emptyLookupOptions;
  const record = value as Partial<LookupOptions>;
  const currentOrganization = isLookupOrganization(record.currentOrganization);
  return {
    serviceAgents: Array.isArray(record.serviceAgents) ? record.serviceAgents : [],
    services: Array.isArray(record.services) ? record.services : [],
    organizations: Array.isArray(record.organizations) ? record.organizations : [],
    currentOrganization,
  };
}

function serviceSummary(selected: string[]) {
  if (!selected.length) return "All services";
  if (selected.length === 1) return selected[0];
  return `${selected.length} services`;
}

function withoutExcludedServices(serviceTypes: string[], excludedServiceNames: string[]) {
  return serviceTypes.filter((name) => !isExcludedServiceName(name, excludedServiceNames));
}

function reportCacheKey(paramsKey: string, excludedServiceNames: string[]) {
  const exclusionsKey = [...excludedServiceNames].sort().join("\u0001");
  return `${paramsKey}::ex:${exclusionsKey}`;
}

function isPublicSettings(value: unknown): value is PublicSettings {
  return Boolean(
    value &&
      typeof value === "object" &&
      "apiBaseUrl" in value &&
      Array.isArray((value as PublicSettings).excludedServiceNames),
  );
}

function isLookupOrganization(value: unknown): LookupOptions["currentOrganization"] {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<NonNullable<LookupOptions["currentOrganization"]>>;
  if (typeof record.displayName !== "string" || !record.displayName.trim()) return null;
  return {
    id: typeof record.id === "string" ? record.id : null,
    name: typeof record.name === "string" ? record.name : null,
    displayName: record.displayName,
    source: typeof record.source === "string" ? record.source : "unavailable",
  };
}

function isReportResponse(value: unknown): value is ReportResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ReportResponse>;
  return (
    (record.source === "live" || record.source === "mock" || record.source === "cache") &&
    (record.warning === null || typeof record.warning === "string") &&
    Array.isArray(record.rows) &&
    Boolean(record.summary && typeof record.summary === "object") &&
    Array.isArray(record.fieldSummaries) &&
    Array.isArray(record.scoreTrends)
  );
}

function mergeAppointmentPreviewDetail(row: PublicRow, detail: PublicRow): PublicRow {
  return {
    ...row,
    servicePrice: detail.servicePrice,
    lineItems: detail.lineItems,
    partsTotal: detail.partsTotal,
    jobTotal: detail.jobTotal,
    appointmentTotal: detail.appointmentTotal ?? row.appointmentTotal,
    appointmentNotes: detail.appointmentNotes ?? row.appointmentNotes,
    serviceName: detail.serviceName ?? row.serviceName,
    serviceAgentName: detail.serviceAgentName ?? row.serviceAgentName,
    status: detail.status ?? row.status,
  };
}

function readDashboardStorage() {
  try {
    const raw = window.localStorage.getItem(dashboardStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      draftFilters?: unknown;
      appliedFilters?: unknown;
      report?: unknown;
      reportParams?: unknown;
      pageSize?: unknown;
      currentPage?: unknown;
      activeTab?: unknown;
      activeDrilldownMetric?: unknown;
      appointmentColumnFilters?: unknown;
    };

    return {
      draftFilters: isDashboardFilters(parsed.draftFilters) ? parsed.draftFilters : null,
      appliedFilters: isDashboardFilters(parsed.appliedFilters) ? parsed.appliedFilters : null,
      report: isReportResponse(parsed.report) ? parsed.report : null,
      reportParams: typeof parsed.reportParams === "string" ? parsed.reportParams : null,
      pageSize: pageSizeOptions.some((option) => option === parsed.pageSize) ? (parsed.pageSize as PageSize) : null,
      currentPage: typeof parsed.currentPage === "number" && Number.isInteger(parsed.currentPage) ? parsed.currentPage : null,
      activeTab:
        parsed.activeTab === "analytics" || parsed.activeTab === "overview"
          ? (parsed.activeTab as DashboardTab)
          : null,
      activeDrilldownMetric:
        typeof parsed.activeDrilldownMetric === "string" && parsed.activeDrilldownMetric in drilldownMetricLabels
          ? (parsed.activeDrilldownMetric as DrilldownMetricKey)
          : null,
      appointmentColumnFilters:
        parsed.appointmentColumnFilters && typeof parsed.appointmentColumnFilters === "object"
          ? ({
              ...emptyAppointmentColumnFilters,
              ...Object.fromEntries(
                Object.keys(emptyAppointmentColumnFilters)
                  .filter((key) => typeof (parsed.appointmentColumnFilters as Record<string, unknown>)[key] === "string")
                  .map((key) => [key, (parsed.appointmentColumnFilters as Record<string, string>)[key]]),
              ),
            } as AppointmentColumnFilters)
          : null,
    };
  } catch {
    return null;
  }
}

function organizationTitleSuffix(
  selectedOrganization: string,
  organizationOptions: string[],
  currentOrganization: LookupOptions["currentOrganization"],
) {
  if (selectedOrganization) return selectedOrganization;
  if (currentOrganization?.displayName) return currentOrganization.displayName;
  return organizationOptions.length === 1 ? organizationOptions[0] : "All organizations";
}

function paginationRange(activePage: number, totalPages: number) {
  const pages = new Set([1, totalPages]);
  for (let page = Math.max(1, activePage - 1); page <= Math.min(totalPages, activePage + 1); page += 1) {
    pages.add(page);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

function previewText(value: string | null | undefined) {
  return value?.trim() || "—";
}

function formatAppointmentCounts(row: PublicRow) {
  const counts = row.contactAppointmentCounts;
  if (!counts || counts.total === null) return formatNumber(row.contactVisitCount);
  return `${formatNumber(counts.total)} total · ${formatNumber(counts.completed)} completed · ${formatNumber(counts.upcoming)} upcoming`;
}

function PreviewDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background/80 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : formatNumber(value, { maximumFractionDigits: 2 });
}

function AppointmentDetailsPanel({
  row,
  loadingDetails,
  detailError,
}: {
  row: PublicRow;
  loadingDetails: boolean;
  detailError: string | null;
}) {
  const lineItems = Array.isArray(row.lineItems) ? row.lineItems : [];
  const hasServicePrice = typeof row.servicePrice === "number";
  const hasLineItems = lineItems.length > 0;
  const hasCostBlock = hasServicePrice || hasLineItems;
  const previewTotal = row.jobTotal ?? row.appointmentTotal;

  return (
    <div className="rounded-md border bg-card text-card-foreground">
      <div className="border-b bg-accent/35 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">Appointment details</p>
            <p className="mt-1 truncate text-base font-semibold">{previewText(row.customerName)}</p>
          </div>
          <Badge variant={row.hasSesScore ? "good" : "warning"}>{row.hasSesScore ? `SES ${row.sesScore?.displayValue ?? "—"}` : "No SES"}</Badge>
        </div>
        <p className="mt-2 truncate text-xs text-muted-foreground">{formatDate(row.appointmentDate ?? row.completedDate)}</p>
      </div>

      <div className="p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <PreviewDetail label="Customer" value={previewText(row.customerName)} />
          <PreviewDetail label="Service" value={previewText(row.serviceName)} />
          <PreviewDetail label="Lifetime value" value={formatCurrency(row.contactLifetimeValue)} />
          <PreviewDetail label="Appointments" value={formatAppointmentCounts(row)} />
          <PreviewDetail label="Technician" value={previewText(row.serviceAgentName)} />
          <PreviewDetail label="SES score" value={row.sesScore?.displayValue || "—"} />
          <PreviewDetail label="Status" value={previewText(row.status)} />
        </div>

        <div className="mt-3 rounded-md border bg-accent/25 p-3">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
            <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
            Work / line items
          </div>
          {hasCostBlock ? (
            <>
              <ul className="space-y-3 text-sm">
                {hasServicePrice ? (
                  <li className="rounded-md border bg-background/80 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{previewText(row.serviceName)}</span>
                      <span className="font-semibold text-foreground">{formatCurrency(row.servicePrice)}</span>
                    </div>
                  </li>
                ) : null}
                {lineItems.map((item, index) => (
                  <li key={`${item.name}-${index}`} className="rounded-md border bg-background/80 px-3 py-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 font-medium text-foreground">{item.name}</span>
                      {item.total !== null ? (
                        <span className="font-semibold text-foreground">{formatCurrency(item.total)}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Qty {formatQuantity(item.quantity)}
                        {item.unitOfMeasure ? ` ${item.unitOfMeasure}` : ""}
                      </span>
                      {item.unitPrice !== null ? <span>{formatCurrency(item.unitPrice)} each</span> : null}
                      {item.sku ? <span>SKU {item.sku}</span> : null}
                    </div>
                    {item.notes ? <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.notes}</p> : null}
                  </li>
                ))}
              </ul>
              {previewTotal !== null ? (
                <div className="mt-3 flex justify-between border-t pt-3 text-sm font-semibold text-foreground">
                  <span>Total</span>
                  <span>{formatCurrency(previewTotal)}</span>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {loadingDetails
                ? "Loading line items from ServiceMinder..."
                : detailError
                  ? detailError
                  : "No line items returned by ServiceMinder."}
            </p>
          )}
        </div>

        <div className="mt-3 rounded-md border bg-accent/25 p-3">
          <p className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">Notes</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
            {row.appointmentNotes?.trim() || "No appointment notes recorded."}
          </p>
        </div>
      </div>
    </div>
  );
}


function tabButtonClassName(active: boolean) {
  return [
    "inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  ].join(" ");
}

function formatCorrelation(value: number | null) {
  return formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function correlationDetail(value: number | null) {
  if (value === null) return "Needs score and ticket variation";
  const absolute = Math.abs(value);
  if (absolute >= 0.7) return value > 0 ? "Strong positive relationship" : "Strong inverse relationship";
  if (absolute >= 0.4) return value > 0 ? "Moderate positive relationship" : "Moderate inverse relationship";
  if (absolute >= 0.2) return value > 0 ? "Light positive relationship" : "Light inverse relationship";
  return "Weak relationship";
}

function barWidth(value: number | null, max: number) {
  if (!value || max <= 0) return 0;
  return Math.max(3, Math.min(100, (value / max) * 100));
}

function firstVisitSesScoreCoverage(rows: PublicRow[]) {
  const firstVisits = rows.filter((row) => row.firstAppointment === true);
  const firstVisitsWithSesScore = firstVisits.filter((row) => row.hasSesScore);
  return {
    firstVisits: firstVisits.length,
    firstVisitsWithSesScore: firstVisitsWithSesScore.length,
    coverageRate: firstVisits.length ? (firstVisitsWithSesScore.length / firstVisits.length) * 100 : 0,
  };
}

function includesText(value: string | number | null | undefined, query: string | null | undefined) {
  const trimmedQuery = query?.trim() ?? "";
  if (!trimmedQuery) return true;
  return String(value ?? "—").toLowerCase().includes(trimmedQuery.toLowerCase());
}

function booleanFilterMatches(value: boolean | null, filter: "" | "yes" | "no") {
  if (!filter) return true;
  if (value === null) return false;
  return filter === "yes" ? value : !value;
}

function appointmentCountsSearchText(row: PublicRow) {
  const counts = row.contactAppointmentCounts;
  return [
    row.contactVisitCount,
    counts?.total,
    counts?.completed,
    counts?.upcoming,
    counts?.total === null || counts?.total === undefined ? null : `${counts.total} total`,
    counts?.completed === null || counts?.completed === undefined ? null : `${counts.completed} completed`,
    counts?.upcoming === null || counts?.upcoming === undefined ? null : `${counts.upcoming} upcoming`,
    formatAppointmentCounts(row),
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(" ");
}

function rowsForDrilldownMetric(rows: PublicRow[], metric: DrilldownMetricKey) {
  switch (metric) {
    case "hasSesScore":
    case "averageSesScore":
      return rows.filter((row) => row.hasSesScore);
    case "firstAppointments":
      return rows.filter((row) => row.firstAppointment === true);
    case "firstVisitsWithSes":
      return rows.filter((row) => row.firstAppointment === true && row.hasSesScore);
    case "missingSesScore":
      return rows.filter((row) => !row.hasSesScore);
    case "completed":
    default:
      return rows;
  }
}

function rowMatchesColumnFilters(row: PublicRow, filters: AppointmentColumnFilters) {
  return (
    includesText(row.id, filters.id) &&
    (includesText(formatDate(row.appointmentDate ?? row.completedDate), filters.appointmentDate) ||
      includesText(row.appointmentDate ?? row.completedDate, filters.appointmentDate)) &&
    includesText(row.serviceName, filters.service) &&
    booleanFilterMatches(row.hasSesScore, filters.hasSesScore) &&
    includesText(row.sesScore?.displayValue, filters.score) &&
    (includesText(formatCurrency(row.appointmentTotal), filters.total) || includesText(row.appointmentTotal, filters.total)) &&
    (includesText(formatCurrency(row.contactLifetimeValue), filters.lifetimeValue) ||
      includesText(row.contactLifetimeValue, filters.lifetimeValue)) &&
    booleanFilterMatches(row.firstAppointment, filters.firstAppointment) &&
    includesText(appointmentCountsSearchText(row), filters.contactVisits)
  );
}

function activeColumnFilterCount(filters: AppointmentColumnFilters) {
  return Object.values(filters).filter(Boolean).length;
}

function SegmentTable({ title, rows }: { title: string; rows: SesValueSegment[] }) {
  const displayedRows = rows.slice(0, 6);

  return (
    <div className="min-w-0 rounded-md border bg-accent/20">
      <div className="border-b px-4 py-3">
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <div className="table-scrollbar overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-medium">Segment</th>
              <th className="px-3 py-3 font-medium">Rows</th>
              <th className="px-3 py-3 font-medium">Avg SES</th>
              <th className="px-3 py-3 font-medium">Avg value</th>
              <th className="px-3 py-3 font-medium">Outliers</th>
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((row) => (
              <tr key={row.key} className="border-b last:border-0">
                <td className="max-w-48 px-3 py-3">
                  <span className="block truncate font-medium">{row.label}</span>
                </td>
                <td className="px-3 py-3">{formatNumber(row.count)}</td>
                <td className="px-3 py-3">{formatScore(row.averageScore)}</td>
                <td className="px-3 py-3">{formatCurrency(row.averageValue)}</td>
                <td className="px-3 py-3">
                  <Badge variant={row.outlierCount ? "warning" : "outline"}>{formatNumber(row.outlierCount)}</Badge>
                </td>
              </tr>
            ))}
            {!displayedRows.length ? (
              <tr>
                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={5}>
                  No analyzable rows.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnalyticsBandChart({ analytics }: { analytics: SesValueAnalytics<PublicRow> }) {
  const maxAverageValue = Math.max(...analytics.bands.map((band) => band.averageValue ?? 0), 1);

  return (
    <div className="grid gap-3">
      {analytics.bands.map((band) => (
        <div key={band.key} className="rounded-md border bg-accent/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">SES {band.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatNumber(band.count)} rows · {formatPercent(band.percentOfAnalyzable)} of analyzable appointments
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold">{formatCurrency(band.averageValue)}</p>
              <p className="text-xs text-muted-foreground">avg value</p>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-background">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${barWidth(band.averageValue, maxAverageValue)}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Total {formatCurrency(band.totalValue)}</span>
            <span>Avg SES {formatScore(band.averageScore)}</span>
            <span>{formatNumber(band.outlierCount)} low-score high-ticket</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsOutlierTable({
  analytics,
  loading,
  expandedAppointmentId,
  appointmentDetailRow,
  toggleAppointmentDetails,
}: {
  analytics: SesValueAnalytics<PublicRow>;
  loading: boolean;
  expandedAppointmentId: string | null;
  appointmentDetailRow: (row: PublicRow) => {
    row: PublicRow;
    loadingDetails: boolean;
    detailError: string | null;
  };
  toggleAppointmentDetails: (row: PublicRow) => void;
}) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Low SES High-Ticket Appointments</CardTitle>
        <CardDescription>
          SES below {LOW_SES_SCORE_THRESHOLD} with value at or above the positive-ticket 75th percentile.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="table-scrollbar overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">Appt Id</th>
                <th className="px-3 py-3 font-medium">Customer</th>
                <th className="px-3 py-3 font-medium">SES</th>
                <th className="px-3 py-3 font-medium">Value</th>
                <th className="px-3 py-3 font-medium">Service</th>
                <th className="px-3 py-3 font-medium">Technician</th>
                <th className="px-3 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {analytics.outliers.slice(0, 12).map((point) => {
                const appointmentId = point.row.id ?? `${point.row.customerName}-${point.row.completedDate}-${point.value}`;
                const expanded = Boolean(point.row.id && expandedAppointmentId === point.row.id);
                const detail = appointmentDetailRow(point.row);

                return (
                  <Fragment key={appointmentId}>
                    <tr className="border-b transition-colors hover:bg-accent/35 last:border-0">
                      <td className="px-3 py-3 font-mono text-xs">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleAppointmentDetails(point.row)}
                            disabled={!point.row.id}
                            aria-expanded={expanded}
                            aria-controls={point.row.id ? `analytics-appointment-details-${point.row.id}` : undefined}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            title={expanded ? "Collapse appointment details" : "Expand appointment details"}
                          >
                            {expanded ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                            <span className="sr-only">{expanded ? "Collapse appointment details" : "Expand appointment details"}</span>
                          </button>
                          {point.row.appointmentUrl ? (
                            <a
                              href={point.row.appointmentUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="Open appointment"
                              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                            >
                              {point.row.id ?? "Open"}
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            </a>
                          ) : (
                            point.row.id ?? "—"
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">{point.row.customerName ?? "—"}</td>
                      <td className="px-3 py-3">
                        <Badge variant="warning">{formatScore(point.score)}</Badge>
                      </td>
                      <td className="px-3 py-3 font-semibold">{formatCurrency(point.value)}</td>
                      <td className="px-3 py-3">{point.row.serviceName ?? "—"}</td>
                      <td className="px-3 py-3">{point.row.serviceAgentName ?? "—"}</td>
                      <td className="px-3 py-3">{formatDate(point.row.completedDate ?? point.row.appointmentDate)}</td>
                    </tr>
                    {expanded ? (
                      <tr id={`analytics-appointment-details-${point.row.id}`} className="border-b bg-accent/20">
                        <td colSpan={7} className="px-3 py-4">
                          <AppointmentDetailsPanel
                            row={detail.row}
                            loadingDetails={detail.loadingDetails}
                            detailError={detail.detailError}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!analytics.outliers.length ? (
                <tr>
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>
                    {loading ? "Loading analytics..." : "No low-score high-ticket appointments for the current filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function AnalyticsTab({
  analytics,
  firstVisitCoverage,
  loading,
  expandedAppointmentId,
  appointmentDetailRow,
  toggleAppointmentDetails,
}: {
  analytics: SesValueAnalytics<PublicRow>;
  firstVisitCoverage: ReturnType<typeof firstVisitSesScoreCoverage>;
  loading: boolean;
  expandedAppointmentId: string | null;
  appointmentDetailRow: (row: PublicRow) => {
    row: PublicRow;
    loadingDetails: boolean;
    detailError: string | null;
  };
  toggleAppointmentDetails: (row: PublicRow) => void;
}) {
  const segmentTables = [
    { title: "By Service", rows: analytics.segments.service },
    { title: "By Technician", rows: analytics.segments.serviceAgent },
    { title: "By Organization", rows: analytics.segments.organization },
    { title: "By First Appointment", rows: analytics.segments.firstAppointment },
    { title: "By Month", rows: analytics.segments.month },
  ];

  return (
    <>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          label="Analyzable rows"
          value={loading ? "…" : formatNumber(analytics.analyzableRows)}
          detail="Rows with SES and value"
          icon={Layers}
          tone="info"
        />
        <MetricCard
          label="High-ticket threshold"
          value={loading ? "…" : formatCurrency(analytics.highTicketThreshold)}
          detail="75th pct positive tickets"
          icon={DollarSign}
          tone="good"
        />
        <MetricCard
          label="Low SES high-ticket"
          value={loading ? "…" : formatNumber(analytics.outliers.length)}
          detail={`SES below ${LOW_SES_SCORE_THRESHOLD}`}
          icon={TrendingDown}
          tone={analytics.outliers.length ? "warning" : "default"}
        />
        <MetricCard
          label="SES/value correlation"
          value={loading ? "…" : formatCorrelation(analytics.correlation)}
          detail={correlationDetail(analytics.correlation)}
          icon={LineChart}
          tone="info"
        />
        <MetricCard
          label="Low SES avg value"
          value={loading ? "…" : formatCurrency(analytics.lowScoreAverageValue)}
          detail={`SES ${LOW_SES_SCORE_THRESHOLD - 1} and below`}
          icon={BarChart3}
        />
        <MetricCard
          label="First visits with SES"
          value={loading ? "…" : formatPercent(firstVisitCoverage.coverageRate)}
          detail={`${formatNumber(firstVisitCoverage.firstVisitsWithSesScore)} of ${formatNumber(firstVisitCoverage.firstVisits)}`}
          icon={Target}
          tone="info"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>SES Band Value Comparison</CardTitle>
            <CardDescription>Average completed appointment value by SES score band.</CardDescription>
          </CardHeader>
          <CardContent>
            <AnalyticsBandChart analytics={analytics} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Score Value Split</CardTitle>
            <CardDescription>Current filtered rows grouped by low versus non-low SES scores.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-accent/20 p-3">
              <p className="text-xs text-muted-foreground">Low SES avg value</p>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(analytics.lowScoreAverageValue)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatNumber(analytics.lowScoreCount)} appointments</p>
            </div>
            <div className="rounded-md border bg-accent/20 p-3">
              <p className="text-xs text-muted-foreground">SES {LOW_SES_SCORE_THRESHOLD}+ avg value</p>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(analytics.nonLowScoreAverageValue)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatNumber(Math.max(0, analytics.analyzableRows - analytics.lowScoreCount))} appointments
              </p>
            </div>
            <div className="rounded-md border bg-accent/20 p-3">
              <p className="text-xs text-muted-foreground">Analyzable total value</p>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(analytics.totalValue)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Avg SES {formatScore(analytics.averageScore)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <AnalyticsOutlierTable
        analytics={analytics}
        loading={loading}
        expandedAppointmentId={expandedAppointmentId}
        appointmentDetailRow={appointmentDetailRow}
        toggleAppointmentDetails={toggleAppointmentDetails}
      />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Segment Comparison</CardTitle>
          <CardDescription>Segments are ranked by outlier count, then average appointment value.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 xl:grid-cols-2">
            {segmentTables.map((section) => (
              <SegmentTable key={section.title} title={section.title} rows={section.rows} />
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

export default function DashboardPage() {
  const initialFilters = useMemo(() => createDefaultFilters(), []);
  const [draftFilters, setDraftFilters] = useState<DashboardFilters>(() => cloneFilters(initialFilters));
  const [appliedFilters, setAppliedFilters] = useState<DashboardFilters>(() => cloneFilters(initialFilters));
  const [report, setReport] = useState<ReportResponse>(emptyReport);
  const [loading, setLoading] = useState(false);
  const [hydratedDashboardState, setHydratedDashboardState] = useState(false);
  const [loadedReportParams, setLoadedReportParams] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [lookupOptions, setLookupOptions] = useState<LookupOptions>(emptyLookupOptions);
  const [excludedServiceNames, setExcludedServiceNames] = useState<string[]>([]);
  const [viewName, setViewName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedAppointmentId, setExpandedAppointmentId] = useState<string | null>(null);
  const [appointmentDetailCache, setAppointmentDetailCache] = useState<Record<string, PublicRow>>({});
  const [appointmentDetailErrors, setAppointmentDetailErrors] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [activeDrilldownMetric, setActiveDrilldownMetric] = useState<DrilldownMetricKey>("completed");
  const [appointmentColumnFilters, setAppointmentColumnFilters] = useState<AppointmentColumnFilters>(emptyAppointmentColumnFilters);
  const drilldownRef = useRef<HTMLDivElement | null>(null);

  const params = useMemo(() => paramsFromFilters(appliedFilters), [appliedFilters]);
  const paramsKey = params.toString();
  const activeReportCacheKey = useMemo(
    () => reportCacheKey(paramsKey, excludedServiceNames),
    [excludedServiceNames, paramsKey],
  );
  const hasPendingFilterChanges = !filtersEqual(draftFilters, appliedFilters);
  const visibleReport = useMemo(
    () => applyExcludedServicesToReport(report, excludedServiceNames),
    [excludedServiceNames, report],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const cached = readDashboardStorage();
      if (cached) {
        if (cached.draftFilters) setDraftFilters(cloneFilters(cached.draftFilters));
        if (cached.appliedFilters) setAppliedFilters(cloneFilters(cached.appliedFilters));
        if (cached.report) setReport(cached.report);
        if (cached.reportParams) setLoadedReportParams(cached.reportParams);
        if (cached.pageSize) setPageSize(cached.pageSize);
        if (cached.currentPage) setCurrentPage(Math.max(1, cached.currentPage));
        if (cached.activeTab) setActiveTab(cached.activeTab);
        if (cached.activeDrilldownMetric) setActiveDrilldownMetric(cached.activeDrilldownMetric);
        if (cached.appointmentColumnFilters) setAppointmentColumnFilters(cached.appointmentColumnFilters);
      }
      setHydratedDashboardState(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydratedDashboardState || loadedReportParams !== activeReportCacheKey) return;
    try {
      window.localStorage.setItem(
        dashboardStorageKey,
        JSON.stringify({
          draftFilters,
          appliedFilters,
          report,
          reportParams: loadedReportParams,
          pageSize,
          currentPage,
          activeTab,
          activeDrilldownMetric,
          appointmentColumnFilters,
        }),
      );
    } catch {
      // Browser storage is a performance cache; quota or privacy failures should not break the dashboard.
    }
  }, [
    activeDrilldownMetric,
    activeTab,
    appliedFilters,
    appointmentColumnFilters,
    currentPage,
    draftFilters,
    hydratedDashboardState,
    activeReportCacheKey,
    loadedReportParams,
    pageSize,
    report,
  ]);

  useEffect(() => {
    if (!hydratedDashboardState) return;
    if (loadedReportParams === activeReportCacheKey) return;

    let active = true;

    async function loadReport() {
      setLoading(true);
      try {
        const requestParams = new URLSearchParams(params);
        const response = await fetch(`/api/reports/conserva?${requestParams.toString()}`);
        const data = (await response.json()) as unknown;
        if (!response.ok || !isReportResponse(data)) throw new Error("Report data could not be loaded.");
        if (active) {
          setReport(data);
          setLoadedReportParams(activeReportCacheKey);
          setNotice(null);
        }
      } catch (error) {
        if (active) {
          setNotice(error instanceof Error ? error.message : "Report data could not be loaded.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadReport();

    return () => {
      active = false;
    };
  }, [activeReportCacheKey, hydratedDashboardState, loadedReportParams, params]);

  useEffect(() => {
    fetch("/api/saved-views")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: SavedView[]) => setSavedViews(Array.isArray(data) ? data : []))
      .catch(() => setSavedViews([]));
  }, []);

  useEffect(() => {
    fetch("/api/lookups")
      .then((response) => (response.ok ? response.json() : emptyLookupOptions))
      .then((data: unknown) => setLookupOptions(normalizeLookupOptions(data)))
      .catch(() => setLookupOptions(emptyLookupOptions));
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (!isPublicSettings(data)) return;
        setExcludedServiceNames(data.excludedServiceNames);
        setDraftFilters((current) => ({
          ...current,
          serviceTypes: withoutExcludedServices(current.serviceTypes, data.excludedServiceNames),
        }));
        setAppliedFilters((current) => ({
          ...current,
          serviceTypes: withoutExcludedServices(current.serviceTypes, data.excludedServiceNames),
        }));
      })
      .catch(() => setExcludedServiceNames([]));
  }, []);

  const serviceAgentOptions = Array.from(
    new Set([...lookupOptions.serviceAgents.map((agent) => agent.name), ...uniqueOptions(visibleReport.rows, "serviceAgentName")]),
  ).sort();
  const serviceOptions = Array.from(
    new Set([
      ...lookupOptions.services.map((service) => service.name),
      ...uniqueOptions(visibleReport.rows, "serviceName"),
      ...draftFilters.serviceTypes,
    ]),
  )
    .filter((name) => !isExcludedServiceName(name, excludedServiceNames))
    .sort();
  const organizationOptions = Array.from(
    new Set([
      ...lookupOptions.organizations.map((nextOrganization) => nextOrganization.name),
      ...uniqueOptions(visibleReport.rows, "organizationName"),
    ]),
  ).sort();
  const dashboardTitle = `SES Score Dashboard - ${organizationTitleSuffix(appliedFilters.organization, organizationOptions, lookupOptions.currentOrganization)}`;
  const sesField = visibleReport.fieldSummaries.find((field) => field.name === "SES Score") ?? visibleReport.fieldSummaries[0] ?? null;
  const trendMax = Math.max(...visibleReport.scoreTrends.map((trend) => trend.average ?? 0), 1);
  const exportHref = `/api/reports/conserva/export?${params.toString()}`;
  const drilldownMetricRows = useMemo(
    () => rowsForDrilldownMetric(visibleReport.rows, activeDrilldownMetric),
    [activeDrilldownMetric, visibleReport.rows],
  );
  const drilldownRows = useMemo(
    () => drilldownMetricRows.filter((row) => rowMatchesColumnFilters(row, appointmentColumnFilters)),
    [appointmentColumnFilters, drilldownMetricRows],
  );
  const totalRows = drilldownRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const activePage = Math.min(currentPage, totalPages);
  const pageStartIndex = (activePage - 1) * pageSize;
  const pagedRows = drilldownRows.slice(pageStartIndex, pageStartIndex + pageSize);
  const pageStart = totalRows ? pageStartIndex + 1 : 0;
  const pageEnd = totalRows ? pageStartIndex + pagedRows.length : 0;
  const paginationPages = paginationRange(activePage, totalPages);
  const analytics = useMemo(() => buildSesValueAnalytics(visibleReport.rows), [visibleReport.rows]);
  const firstVisitCoverage = useMemo(() => firstVisitSesScoreCoverage(visibleReport.rows), [visibleReport.rows]);
  const columnFilterCount = activeColumnFilterCount(appointmentColumnFilters);

  function updateDraftDatePreset(nextPreset: DateRangePreset) {
    setDraftFilters((current) => {
      if (nextPreset === "custom") return { ...current, datePreset: nextPreset };
      const nextRange = relativeDateRange(nextPreset);
      return {
        ...current,
        datePreset: nextPreset,
        from: nextRange.from,
        through: nextRange.through,
      };
    });
  }

  function applyFilters() {
    setAppliedFilters(cloneFilters(draftFilters));
    setCurrentPage(1);
  }

  async function refreshReport() {
    setLoading(true);
    try {
      const requestParams = new URLSearchParams(params);
      requestParams.set("refreshCache", "true");
      const response = await fetch(`/api/reports/conserva?${requestParams.toString()}`);
      const data = (await response.json()) as unknown;
      if (!response.ok || !isReportResponse(data)) throw new Error("Report data could not be refreshed.");
      setReport(data);
      setLoadedReportParams(activeReportCacheKey);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Report data could not be refreshed.");
    } finally {
      setLoading(false);
    }
  }

  async function saveCurrentView() {
    if (!viewName.trim()) {
      setNotice("Name the view before saving it.");
      return;
    }
    const response = await fetch("/api/saved-views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: viewName.trim(),
        filters: filterRecord(draftFilters),
        columns: [],
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      setNotice(error.error ?? "Saved views require a configured database.");
      return;
    }
    const saved = await response.json();
    setSavedViews((current) => [saved, ...current]);
    setViewName("");
    setNotice("View saved.");
  }

  async function deleteView(id: string) {
    await fetch(`/api/saved-views?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setSavedViews((current) => current.filter((view) => view.id !== id));
  }

  function applyView(view: SavedView) {
    const nextFilters = filtersFromSavedView(view, initialFilters);
    setDraftFilters(cloneFilters(nextFilters));
    setAppliedFilters(cloneFilters(nextFilters));
    setCurrentPage(1);
  }

  function goToPage(page: number) {
    setCurrentPage(Math.min(Math.max(page, 1), totalPages));
  }

  function updatePageSize(value: string) {
    setPageSize(Number(value) as PageSize);
    setCurrentPage(1);
  }

  function selectDrilldownMetric(metric: DrilldownMetricKey) {
    setActiveTab("overview");
    setActiveDrilldownMetric(metric);
    setCurrentPage(1);
    window.requestAnimationFrame(() => {
      drilldownRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function updateAppointmentColumnFilter<Key extends keyof AppointmentColumnFilters>(
    key: Key,
    value: AppointmentColumnFilters[Key],
  ) {
    setAppointmentColumnFilters((current) => ({ ...current, [key]: value }));
    setCurrentPage(1);
  }

  function appointmentDetailRow(row: PublicRow) {
    const appointmentId = row.id ?? "";
    const cachedDetail = appointmentId ? appointmentDetailCache[appointmentId] : undefined;
    const detailError = appointmentId ? appointmentDetailErrors[appointmentId] ?? null : null;
    return {
      row: cachedDetail ? mergeAppointmentPreviewDetail(row, cachedDetail) : row,
      loadingDetails: Boolean(appointmentId && expandedAppointmentId === appointmentId && !cachedDetail && !detailError),
      detailError,
    };
  }

  function toggleAppointmentDetails(row: PublicRow) {
    const appointmentId = row.id ?? "";
    if (!appointmentId) return;

    setExpandedAppointmentId((current) => (current === appointmentId ? null : appointmentId));

    if (!appointmentDetailCache[appointmentId] && !appointmentDetailErrors[appointmentId]) {
      void fetchAppointmentPreviewDetail(appointmentId);
    }
  }

  async function fetchAppointmentPreviewDetail(appointmentId: string) {
    try {
      const response = await fetch(`/api/reports/conserva/appointments/${encodeURIComponent(appointmentId)}`);
      const data = (await response.json()) as unknown;
      if (!response.ok || !data || typeof data !== "object" || !("row" in data) || !isReportResponse({ ...emptyReport, rows: [(data as { row: unknown }).row] })) {
        throw new Error("Appointment line items could not be loaded.");
      }
      const detail = (data as { row: PublicRow }).row;
      setAppointmentDetailCache((current) => ({ ...current, [appointmentId]: detail }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Appointment line items could not be loaded.";
      setAppointmentDetailErrors((current) => ({ ...current, [appointmentId]: message }));
    }
  }

  return (
    <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <PageHeading
        title={dashboardTitle}
        eyebrow="Conserva reporting"
        description="Completed appointment tracking centered on the primary ServiceMinder contact custom field {contact.cust_sesscore}."
      >
        <Button type="button" variant="outline" onClick={refreshReport} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <a
          href={exportHref}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary/20 bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </a>
      </PageHeading>

      {report.warning ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
          {report.warning}
        </div>
      ) : null}

      {excludedServiceNames.length ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Hiding {excludedServiceNames.length} service{excludedServiceNames.length === 1 ? "" : "s"} from settings
          {excludedServiceNames.length <= 3 ? `: ${excludedServiceNames.join(", ")}` : ""}.{" "}
          <a href="/settings" className="font-medium text-foreground underline-offset-4 hover:underline">
            Change exclusions
          </a>
        </p>
      ) : null}

      <Card className="mt-6 lg:sticky lg:top-14 lg:z-30">
        <CardContent className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-[160px_150px_150px_minmax(130px,1fr)_minmax(170px,1.15fr)_minmax(150px,1fr)_110px] xl:items-end">
          <div className="grid gap-2">
            <Label htmlFor="datePreset">Date range</Label>
            <select
              id="datePreset"
              value={draftFilters.datePreset}
              onChange={(event) => updateDraftDatePreset(event.target.value as DateRangePreset)}
              className={selectClassName()}
            >
              {dateRangePresets.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
          <DateRangeFields
            idPrefix="dashboard"
            from={draftFilters.from}
            through={draftFilters.through}
            onChange={(value) => {
              setDraftFilters((current) => ({
                ...current,
                datePreset: "custom",
                from: value.from,
                through: value.through,
              }));
            }}
          />
          <div className="grid gap-2">
            <Label htmlFor="serviceAgent">Service agent</Label>
            <select
              id="serviceAgent"
              value={draftFilters.serviceAgentName}
              onChange={(event) => {
                setDraftFilters((current) => ({ ...current, serviceAgentName: event.target.value }));
              }}
              className={selectClassName()}
            >
              <option value="">All agents</option>
              {serviceAgentOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <MultiSelectFilter
            id="serviceTypes"
            label="Services"
            options={serviceOptions}
            value={draftFilters.serviceTypes}
            summary={serviceSummary}
            emptySelectionLabel="All services"
            onChange={(value) => {
              setDraftFilters((current) => ({ ...current, serviceTypes: value }));
            }}
          />
          <div className="grid gap-2">
            <Label htmlFor="organization">Organization</Label>
            <select
              id="organization"
              value={draftFilters.organization}
              onChange={(event) => {
                setDraftFilters((current) => ({ ...current, organization: event.target.value }));
              }}
              className={selectClassName()}
            >
              <option value="">All organizations</option>
              {organizationOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            className="w-full"
            variant={hasPendingFilterChanges ? "default" : "outline"}
            disabled={!hasPendingFilterChanges}
            onClick={applyFilters}
          >
            {loading && !hasPendingFilterChanges ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
            {hasPendingFilterChanges ? "Apply" : loading ? "Loading" : "Applied"}
          </Button>
        </CardContent>
        <CardContent className="grid gap-4 border-t p-4 md:grid-cols-[1fr_120px_120px_auto] md:items-end">
          <div className="grid gap-2">
            <Label htmlFor="search">Search rows</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                value={draftFilters.search}
                onChange={(event) => {
                  setDraftFilters((current) => ({ ...current, search: event.target.value }));
                }}
                className="pl-9"
                placeholder="Org, service, score, status"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="minScore">Min score</Label>
            <Input
              id="minScore"
              type="number"
              value={draftFilters.minScore}
              onChange={(event) => {
                setDraftFilters((current) => ({ ...current, minScore: event.target.value }));
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="maxScore">Max score</Label>
            <Input
              id="maxScore"
              type="number"
              value={draftFilters.maxScore}
              onChange={(event) => {
                setDraftFilters((current) => ({ ...current, maxScore: event.target.value }));
              }}
            />
          </div>
          <div className="flex min-h-9 items-center gap-3 rounded-md border bg-accent/30 px-3">
            <Switch
              id="missingSesScore"
              checked={draftFilters.missingSesScore}
              onCheckedChange={(value) => {
                setDraftFilters((current) => ({ ...current, missingSesScore: value }));
              }}
            />
            <Label htmlFor="missingSesScore" className="text-sm font-normal text-muted-foreground">
              Missing SES score
            </Label>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-b pb-3" role="tablist" aria-label="Dashboard views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "overview"}
          className={tabButtonClassName(activeTab === "overview")}
          onClick={() => setActiveTab("overview")}
        >
          <BarChart3 className="h-4 w-4" aria-hidden="true" />
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "analytics"}
          className={tabButtonClassName(activeTab === "analytics")}
          onClick={() => setActiveTab("analytics")}
        >
          <LineChart className="h-4 w-4" aria-hidden="true" />
          Analytics
        </button>
      </div>

      {activeTab === "overview" ? (
        <>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          label="Completed appointments"
          value={loading ? "…" : formatNumber(visibleReport.summary.completedAppointments)}
          icon={CheckCircle2}
          tone="good"
          selected={activeDrilldownMetric === "completed"}
          onClick={() => selectDrilldownMetric("completed")}
        />
        <MetricCard
          label="Has SES score"
          value={loading ? "…" : formatNumber(visibleReport.summary.appointmentsWithSesScore)}
          detail={formatPercent(visibleReport.summary.sesScoreCoverageRate)}
          icon={FileSpreadsheet}
          tone="info"
          selected={activeDrilldownMetric === "hasSesScore"}
          onClick={() => selectDrilldownMetric("hasSesScore")}
        />
        <MetricCard
          label="Average SES score"
          value={loading ? "…" : formatScore(visibleReport.summary.averageSesScore)}
          detail={`${formatScore(visibleReport.summary.minSesScore)}-${formatScore(visibleReport.summary.maxSesScore)} range`}
          icon={Star}
          tone="good"
          selected={activeDrilldownMetric === "averageSesScore"}
          onClick={() => selectDrilldownMetric("averageSesScore")}
        />
        <MetricCard
          label="First appointments"
          value={loading ? "…" : formatNumber(visibleReport.summary.firstAppointments)}
          detail={formatCurrency(visibleReport.summary.totalAppointmentValue)}
          icon={Target}
          selected={activeDrilldownMetric === "firstAppointments"}
          onClick={() => selectDrilldownMetric("firstAppointments")}
        />
        <MetricCard
          label="First visits with SES"
          value={loading ? "…" : formatPercent(visibleReport.summary.firstAppointmentSesScoreCoverageRate)}
          detail={`${formatNumber(visibleReport.summary.firstAppointmentsWithSesScore)} of ${formatNumber(visibleReport.summary.firstAppointments)}`}
          icon={FileSpreadsheet}
          tone="info"
          selected={activeDrilldownMetric === "firstVisitsWithSes"}
          onClick={() => selectDrilldownMetric("firstVisitsWithSes")}
        />
        <MetricCard
          label="Missing SES score"
          value={loading ? "…" : formatNumber(visibleReport.summary.missingSesScore)}
          icon={AlertTriangle}
          tone={visibleReport.summary.missingSesScore ? "warning" : "default"}
          selected={activeDrilldownMetric === "missingSesScore"}
          onClick={() => selectDrilldownMetric("missingSesScore")}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>SES Score Coverage</CardTitle>
            <CardDescription>Primary score field: contact.cust_sesscore.</CardDescription>
          </CardHeader>
          <CardContent>
            {sesField ? (
              <div className="rounded-md border bg-accent/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">contact.cust_sesscore</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {sesField.count} populated · {sesField.missingCount} missing · {scoreRangeText(sesField)}
                    </p>
                  </div>
                  <Badge variant="good">Primary field</Badge>
                </div>
                <div className="mt-4 h-2 rounded-full bg-background">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, sesField.coverageRate)}%` }} />
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatPercent(sesField.coverageRate)} coverage</span>
                  <span>Avg {formatScore(sesField.average)}</span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-md bg-background p-3">
                    <p className="text-xs text-muted-foreground">Minimum</p>
                    <p className="mt-1 font-semibold">{formatScore(sesField.min)}</p>
                  </div>
                  <div className="rounded-md bg-background p-3">
                    <p className="text-xs text-muted-foreground">Maximum</p>
                    <p className="mt-1 font-semibold">{formatScore(sesField.max)}</p>
                  </div>
                  <div className="rounded-md bg-background p-3">
                    <p className="text-xs text-muted-foreground">Numeric values</p>
                    <p className="mt-1 font-semibold">{formatNumber(sesField.numericCount)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No SES scores found for the current filters.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saved Views</CardTitle>
            <CardDescription>Save reusable filter sets for recurring Conserva reporting.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
            <div className="flex gap-2">
              <Input value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="Monthly score review" />
              <Button type="button" onClick={saveCurrentView}>
                <Save className="h-4 w-4" />
                Save
              </Button>
            </div>
            <div className="space-y-2">
              {savedViews.map((view) => (
                <div key={view.id} className="flex items-center justify-between gap-2 rounded-md border bg-accent/20 px-3 py-2">
                  <button type="button" className="truncate text-left text-sm font-medium" onClick={() => applyView(view)}>
                    {view.name}
                  </button>
                  <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-primary" onClick={() => deleteView(view.id)} aria-label={`Delete ${view.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {!savedViews.length ? <p className="text-sm text-muted-foreground">No saved views yet.</p> : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>SES Score Trends</CardTitle>
          <CardDescription>Monthly average for contact.cust_sesscore.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleReport.scoreTrends.slice(0, 9).map((trend) => (
              <div key={`${trend.period}-${trend.fieldName}`} className="rounded-md border bg-accent/20 p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{trend.fieldName}</span>
                  <span className="font-mono text-muted-foreground">{trend.period}</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-background">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(4, ((trend.average ?? 0) / trendMax) * 100)}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Avg {formatScore(trend.average)}</span>
                  <span>{trend.count} scores</span>
                </div>
              </div>
            ))}
            {!visibleReport.scoreTrends.length ? <p className="text-sm text-muted-foreground">No numeric SES score trends for the current filters.</p> : null}
          </div>
        </CardContent>
      </Card>

      <div ref={drilldownRef} />
      <Card className="mt-6">
        <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Appointment Drill-down</CardTitle>
              <Badge variant="outline">{drilldownMetricLabels[activeDrilldownMetric]}</Badge>
            </div>
            <CardDescription>
              {formatNumber(drilldownMetricRows.length)} metric rows
              {columnFilterCount ? `, ${formatNumber(totalRows)} after ${columnFilterCount} column filter${columnFilterCount === 1 ? "" : "s"}` : ""}
              .
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeDrilldownMetric !== "completed" || columnFilterCount ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setActiveDrilldownMetric("completed");
                  setAppointmentColumnFilters(emptyAppointmentColumnFilters);
                  setCurrentPage(1);
                }}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Clear drill-down
              </Button>
            ) : null}
            <Label htmlFor="appointmentPageSize" className="text-xs font-medium text-muted-foreground">
              Rows per page
            </Label>
            <select
              id="appointmentPageSize"
              value={pageSize}
              onChange={(event) => updatePageSize(event.target.value)}
              className={`${selectClassName()} w-24`}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="table-scrollbar overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="border-b text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 font-medium">Appt Id</th>
                  <th className="px-3 py-3 font-medium">Appointment Date</th>
                  <th className="px-3 py-3 font-medium">Service</th>
                  <th className="px-3 py-3 font-medium">Has SES Score?</th>
                  <th className="px-3 py-3 font-medium">Score</th>
                  <th className="px-3 py-3 font-medium">Total</th>
                  <th className="px-3 py-3 font-medium">Lifetime Value</th>
                  <th className="px-3 py-3 font-medium">First Appt?</th>
                  <th className="px-3 py-3 font-medium">Appointments</th>
                </tr>
                <tr className="border-t bg-accent/20 normal-case">
                  <th className="px-3 py-2">
                    <Input
                      value={appointmentColumnFilters.id}
                      onChange={(event) => updateAppointmentColumnFilter("id", event.target.value)}
                      placeholder="Filter ID"
                      className="h-8 min-w-28 text-xs"
                    />
                  </th>
                  <th className="px-3 py-2">
                    <Input
                      value={appointmentColumnFilters.appointmentDate}
                      onChange={(event) => updateAppointmentColumnFilter("appointmentDate", event.target.value)}
                      placeholder="Date"
                      className="h-8 min-w-32 text-xs"
                    />
                  </th>
                  <th className="px-3 py-2">
                    <Input
                      value={appointmentColumnFilters.service}
                      onChange={(event) => updateAppointmentColumnFilter("service", event.target.value)}
                      placeholder="Service"
                      className="h-8 min-w-40 text-xs"
                    />
                  </th>
                  <th className="px-3 py-2">
                    <select
                      value={appointmentColumnFilters.hasSesScore}
                      onChange={(event) => updateAppointmentColumnFilter("hasSesScore", event.target.value as AppointmentColumnFilters["hasSesScore"])}
                      className={`${selectClassName()} h-8 min-w-28 text-xs`}
                      aria-label="Filter has SES score"
                    >
                      <option value="">All</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </th>
                  <th className="px-3 py-2">
                    <Input
                      value={appointmentColumnFilters.score}
                      onChange={(event) => updateAppointmentColumnFilter("score", event.target.value)}
                      placeholder="Score"
                      className="h-8 min-w-24 text-xs"
                    />
                  </th>
                  <th className="px-3 py-2">
                    <Input
                      value={appointmentColumnFilters.total}
                      onChange={(event) => updateAppointmentColumnFilter("total", event.target.value)}
                      placeholder="Total"
                      className="h-8 min-w-24 text-xs"
                    />
                  </th>
                  <th className="px-3 py-2">
                    <Input
                      value={appointmentColumnFilters.lifetimeValue}
                      onChange={(event) => updateAppointmentColumnFilter("lifetimeValue", event.target.value)}
                      placeholder="LTV"
                      className="h-8 min-w-24 text-xs"
                    />
                  </th>
                  <th className="px-3 py-2">
                    <select
                      value={appointmentColumnFilters.firstAppointment}
                      onChange={(event) =>
                        updateAppointmentColumnFilter("firstAppointment", event.target.value as AppointmentColumnFilters["firstAppointment"])
                      }
                      className={`${selectClassName()} h-8 min-w-28 text-xs`}
                      aria-label="Filter first appointment"
                    >
                      <option value="">All</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </th>
                  <th className="px-3 py-2">
                    <Input
                      value={appointmentColumnFilters.contactVisits}
                      onChange={(event) => updateAppointmentColumnFilter("contactVisits", event.target.value)}
                      placeholder="Appts"
                      className="h-8 min-w-32 text-xs"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => {
                  const appointmentId = row.id ?? `${row.customerName}-${row.completedDate}`;
                  const expanded = Boolean(row.id && expandedAppointmentId === row.id);
                  const detail = appointmentDetailRow(row);

                  return (
                    <Fragment key={appointmentId}>
                      <tr className="border-b transition-colors hover:bg-accent/35 last:border-0">
                        <td className="px-3 py-3 font-mono text-xs">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => toggleAppointmentDetails(row)}
                              disabled={!row.id}
                              aria-expanded={expanded}
                              aria-controls={row.id ? `appointment-details-${row.id}` : undefined}
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
                              title={expanded ? "Collapse appointment details" : "Expand appointment details"}
                            >
                              {expanded ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                              <span className="sr-only">{expanded ? "Collapse appointment details" : "Expand appointment details"}</span>
                            </button>
                            {row.appointmentUrl ? (
                              <a
                                href={row.appointmentUrl}
                                target="_blank"
                                rel="noreferrer"
                                title="Open appointment"
                                className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                              >
                                {row.id ?? "Open"}
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              </a>
                            ) : (
                              row.id ?? "—"
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3">{formatDate(row.appointmentDate ?? row.completedDate)}</td>
                        <td className="px-3 py-3">{row.serviceName ?? "—"}</td>
                        <td className="px-3 py-3">
                          <Badge variant={row.hasSesScore ? "good" : "warning"}>{row.hasSesScore ? "Yes" : "No"}</Badge>
                        </td>
                        <td className="px-3 py-3 font-semibold">{row.sesScore?.displayValue || "—"}</td>
                        <td className="px-3 py-3">{formatCurrency(row.appointmentTotal)}</td>
                        <td className="px-3 py-3">{formatCurrency(row.contactLifetimeValue)}</td>
                        <td className="px-3 py-3">
                          {row.firstAppointment === null ? "—" : row.firstAppointment ? "Yes" : "No"}
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{formatAppointmentCounts(row)}</td>
                      </tr>
                      {expanded ? (
                        <tr id={`appointment-details-${row.id}`} className="border-b bg-accent/20">
                          <td colSpan={9} className="px-3 py-4">
                            <AppointmentDetailsPanel
                              row={detail.row}
                              loadingDetails={detail.loadingDetails}
                              detailError={detail.detailError}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {!pagedRows.length ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-muted-foreground" colSpan={9}>
                      {loading ? "Loading appointments..." : "No appointments for the current filters."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {loading
                ? "Loading appointment rows..."
                : `Showing ${pageStart}-${pageEnd} of ${totalRows} drill-down rows. Export CSV includes the dashboard filter set.`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => goToPage(activePage - 1)} disabled={activePage <= 1}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {paginationPages.map((page, index) => (
                  <Fragment key={page}>
                    {index > 0 && page - paginationPages[index - 1] > 1 ? (
                      <span className="px-1 text-xs text-muted-foreground">…</span>
                    ) : null}
                    <Button
                      type="button"
                      variant={page === activePage ? "default" : "outline"}
                      size="sm"
                      className="min-w-8 px-2"
                      onClick={() => goToPage(page)}
                      aria-current={page === activePage ? "page" : undefined}
                    >
                      {page}
                    </Button>
                  </Fragment>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => goToPage(activePage + 1)} disabled={activePage >= totalPages}>
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Exploration Status</CardTitle>
          <CardDescription>Use the local script to confirm contact.cust_sesscore and the appointment status fields in live Conserva payloads.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-md border bg-accent/20 px-4 py-3 text-sm">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <code className="font-mono whitespace-pre-wrap">
              {`SERVICEMINDER_API_KEY="..." npm run explore:appointments -- --from ${appliedFilters.from} --through ${appliedFilters.through}`}
            </code>
          </div>
        </CardContent>
      </Card>
        </>
      ) : (
        <AnalyticsTab
          analytics={analytics}
          firstVisitCoverage={firstVisitCoverage}
          loading={loading}
          expandedAppointmentId={expandedAppointmentId}
          appointmentDetailRow={appointmentDetailRow}
          toggleAppointmentDetails={toggleAppointmentDetails}
        />
      )}
    </main>
  );
}
