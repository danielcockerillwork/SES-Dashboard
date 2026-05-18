import { summarizeFieldValues } from "@/lib/serviceminder/custom-fields";
import { isExcludedServiceName } from "@/lib/serviceminder/service-exclusions";
import type {
  ConservaAppointmentRow,
  ConservaReportSummary,
  ScoreTrendPoint,
} from "@/lib/serviceminder/types";

const SES_SCORE_FIELD_NAME = "SES Score";

type SummarizableAppointmentRow = Omit<ConservaAppointmentRow, "raw">;

type ReportWithSummarizableRows<Row extends SummarizableAppointmentRow> = {
  source: "live" | "mock" | "cache";
  warning: string | null;
  rows: Row[];
  summary: ConservaReportSummary;
  fieldSummaries: ReturnType<typeof summarizeFieldValues>;
  scoreTrends: ScoreTrendPoint[];
  rawPayloads: unknown[];
};

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function summarizeRows(rows: SummarizableAppointmentRow[]): ConservaReportSummary {
  const sesRows = rows.filter((row) => row.hasSesScore);
  const scoreValues = rows
    .map((row) => row.sesScore?.numericValue)
    .filter((value): value is number => value !== null && value !== undefined);
  const firstAppointments = rows.filter((row) => row.firstAppointment === true).length;
  const firstAppointmentsWithSesScore = rows.filter((row) => row.firstAppointment === true && row.hasSesScore).length;
  const totalAppointmentValue = rows.reduce((sum, row) => sum + (row.appointmentTotal ?? 0), 0);

  return {
    completedAppointments: rows.length,
    appointmentsWithSesScore: sesRows.length,
    sesScoreCoverageRate: rows.length ? (sesRows.length / rows.length) * 100 : 0,
    missingSesScore: rows.length - sesRows.length,
    averageSesScore: average(scoreValues),
    minSesScore: scoreValues.length ? Math.min(...scoreValues) : null,
    maxSesScore: scoreValues.length ? Math.max(...scoreValues) : null,
    firstAppointments,
    firstAppointmentsWithSesScore,
    firstAppointmentSesScoreCoverageRate: firstAppointments ? (firstAppointmentsWithSesScore / firstAppointments) * 100 : 0,
    totalAppointmentValue,
    appointmentsWithCustomFields: sesRows.length,
    customFieldCoverageRate: rows.length ? (sesRows.length / rows.length) * 100 : 0,
    selectedFieldCoverageRate: rows.length ? (sesRows.length / rows.length) * 100 : 0,
    selectedFieldMissing: rows.length - sesRows.length,
    scoreFieldCount: sesRows.length ? 1 : 0,
    averageScore: average(scoreValues),
    missingAnyCustomField: rows.length - sesRows.length,
  };
}

function scoreTrends(rows: SummarizableAppointmentRow[]): ScoreTrendPoint[] {
  const buckets = new Map<string, number[]>();

  for (const row of rows) {
    const date = row.completedDate ?? row.appointmentDate;
    if (!date) continue;
    const score = row.sesScore?.numericValue ?? null;
    if (score === null) continue;
    const period = date.slice(0, 7);
    const values = buckets.get(period) ?? [];
    values.push(score);
    buckets.set(period, values);
  }

  return Array.from(buckets.entries())
    .map(([period, values]) => ({
      period,
      fieldName: SES_SCORE_FIELD_NAME,
      average: average(values),
      count: values.length,
    }))
    .sort((left, right) => left.period.localeCompare(right.period));
}

export function applyExcludedServicesToReport<Row extends SummarizableAppointmentRow>(
  result: ReportWithSummarizableRows<Row>,
  excludedServiceNames: string[],
): ReportWithSummarizableRows<Row> {
  const rows = result.rows.filter((row) => !isExcludedServiceName(row.serviceName, excludedServiceNames));
  if (rows.length === result.rows.length) return result;
  const allFields = rows.flatMap((row) => row.customFields);
  return {
    ...result,
    rows,
    summary: summarizeRows(rows),
    fieldSummaries: summarizeFieldValues(rows.length, allFields),
    scoreTrends: scoreTrends(rows),
  };
}
