import type { ConservaAppointmentRow } from "@/lib/serviceminder/types";

export const LOW_SES_SCORE_THRESHOLD = 80;
export const HIGH_TICKET_PERCENTILE = 0.75;

export type AnalyticsAppointmentRow = Pick<
  ConservaAppointmentRow,
  | "id"
  | "appointmentUrl"
  | "appointmentDate"
  | "completedDate"
  | "customerName"
  | "serviceName"
  | "serviceAgentName"
  | "organizationName"
  | "appointmentTotal"
  | "firstAppointment"
  | "sesScore"
>;

export type SesValuePoint<T extends AnalyticsAppointmentRow = AnalyticsAppointmentRow> = {
  row: T;
  score: number;
  value: number;
  period: string;
  lowScore: boolean;
  highTicket: boolean;
  outlier: boolean;
};

export type SesValueBand = {
  key: "lt70" | "70-79" | "80-89" | "90plus";
  label: string;
  count: number;
  averageScore: number | null;
  averageValue: number | null;
  totalValue: number;
  lowScoreCount: number;
  highTicketCount: number;
  outlierCount: number;
  percentOfAnalyzable: number;
};

export type SesValueSegment = {
  key: string;
  label: string;
  count: number;
  averageScore: number | null;
  averageValue: number | null;
  totalValue: number;
  lowScoreCount: number;
  highTicketCount: number;
  outlierCount: number;
};

export type SesValueAnalytics<T extends AnalyticsAppointmentRow = AnalyticsAppointmentRow> = {
  analyzableRows: number;
  averageScore: number | null;
  averageValue: number | null;
  totalValue: number;
  lowScoreCount: number;
  lowScoreAverageValue: number | null;
  nonLowScoreAverageValue: number | null;
  highTicketThreshold: number | null;
  correlation: number | null;
  points: Array<SesValuePoint<T>>;
  bands: SesValueBand[];
  outliers: Array<SesValuePoint<T>>;
  segments: {
    service: SesValueSegment[];
    serviceAgent: SesValueSegment[];
    organization: SesValueSegment[];
    firstAppointment: SesValueSegment[];
    month: SesValueSegment[];
  };
};

const SES_BANDS: Array<{
  key: SesValueBand["key"];
  label: string;
  matches: (score: number) => boolean;
}> = [
  { key: "lt70", label: "<70", matches: (score) => score < 70 },
  { key: "70-79", label: "70-79", matches: (score) => score >= 70 && score < 80 },
  { key: "80-89", label: "80-89", matches: (score) => score >= 80 && score < 90 },
  { key: "90plus", label: "90+", matches: (score) => score >= 90 },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function nearestRankPercentile(values: number[], percentile: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(percentile * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function pearsonCorrelation(points: Array<{ score: number; value: number }>) {
  if (points.length < 2) return null;

  const averageScore = average(points.map((point) => point.score));
  const averageValue = average(points.map((point) => point.value));
  if (averageScore === null || averageValue === null) return null;

  let numerator = 0;
  let scoreVariance = 0;
  let valueVariance = 0;

  for (const point of points) {
    const scoreDelta = point.score - averageScore;
    const valueDelta = point.value - averageValue;
    numerator += scoreDelta * valueDelta;
    scoreVariance += scoreDelta ** 2;
    valueVariance += valueDelta ** 2;
  }

  const denominator = Math.sqrt(scoreVariance * valueVariance);
  return denominator === 0 ? null : numerator / denominator;
}

function periodKey(row: AnalyticsAppointmentRow) {
  const date = row.completedDate ?? row.appointmentDate;
  return date ? date.slice(0, 7) : "No date";
}

function segmentLabel(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

function firstAppointmentLabel(value: boolean | null) {
  if (value === true) return "First appointment";
  if (value === false) return "Returning appointment";
  return "Unknown";
}

function segmentRows<T extends AnalyticsAppointmentRow>(
  points: Array<SesValuePoint<T>>,
  keyForPoint: (point: SesValuePoint<T>) => string,
) {
  const byKey = new Map<string, Array<SesValuePoint<T>>>();

  for (const point of points) {
    const key = keyForPoint(point);
    const current = byKey.get(key) ?? [];
    current.push(point);
    byKey.set(key, current);
  }

  return Array.from(byKey.entries())
    .map(([key, values]) => {
      const ticketValues = values.map((point) => point.value);
      return {
        key,
        label: key,
        count: values.length,
        averageScore: average(values.map((point) => point.score)),
        averageValue: average(ticketValues),
        totalValue: ticketValues.reduce((sum, value) => sum + value, 0),
        lowScoreCount: values.filter((point) => point.lowScore).length,
        highTicketCount: values.filter((point) => point.highTicket).length,
        outlierCount: values.filter((point) => point.outlier).length,
      };
    })
    .sort((left, right) => {
      return (
        right.outlierCount - left.outlierCount ||
        (right.averageValue ?? 0) - (left.averageValue ?? 0) ||
        right.count - left.count ||
        left.label.localeCompare(right.label)
      );
    });
}

function bandRows<T extends AnalyticsAppointmentRow>(
  points: Array<SesValuePoint<T>>,
  analyzableRows: number,
): SesValueBand[] {
  return SES_BANDS.map((band) => {
    const values = points.filter((point) => band.matches(point.score));
    const ticketValues = values.map((point) => point.value);

    return {
      key: band.key,
      label: band.label,
      count: values.length,
      averageScore: average(values.map((point) => point.score)),
      averageValue: average(ticketValues),
      totalValue: ticketValues.reduce((sum, value) => sum + value, 0),
      lowScoreCount: values.filter((point) => point.lowScore).length,
      highTicketCount: values.filter((point) => point.highTicket).length,
      outlierCount: values.filter((point) => point.outlier).length,
      percentOfAnalyzable: analyzableRows ? (values.length / analyzableRows) * 100 : 0,
    };
  });
}

export function buildSesValueAnalytics<T extends AnalyticsAppointmentRow>(
  rows: T[],
): SesValueAnalytics<T> {
  const analyzableRows = rows
    .map((row) => ({
      row,
      score: row.sesScore?.numericValue,
      value: row.appointmentTotal,
    }))
    .filter(
      (point): point is { row: T; score: number; value: number } =>
        isFiniteNumber(point.score) && isFiniteNumber(point.value),
    );

  const positiveTicketValues = analyzableRows.map((point) => point.value).filter((value) => value > 0);
  const highTicketThreshold = nearestRankPercentile(positiveTicketValues, HIGH_TICKET_PERCENTILE);

  const points = analyzableRows.map((point) => {
    const lowScore = point.score < LOW_SES_SCORE_THRESHOLD;
    const highTicket = highTicketThreshold !== null && point.value >= highTicketThreshold;
    return {
      ...point,
      period: periodKey(point.row),
      lowScore,
      highTicket,
      outlier: lowScore && highTicket,
    };
  });

  const lowScorePoints = points.filter((point) => point.lowScore);
  const nonLowScorePoints = points.filter((point) => !point.lowScore);
  const ticketValues = points.map((point) => point.value);

  return {
    analyzableRows: points.length,
    averageScore: average(points.map((point) => point.score)),
    averageValue: average(ticketValues),
    totalValue: ticketValues.reduce((sum, value) => sum + value, 0),
    lowScoreCount: lowScorePoints.length,
    lowScoreAverageValue: average(lowScorePoints.map((point) => point.value)),
    nonLowScoreAverageValue: average(nonLowScorePoints.map((point) => point.value)),
    highTicketThreshold,
    correlation: pearsonCorrelation(points),
    points,
    bands: bandRows(points, points.length),
    outliers: points
      .filter((point) => point.outlier)
      .sort((left, right) => right.value - left.value || left.score - right.score),
    segments: {
      service: segmentRows(points, (point) => segmentLabel(point.row.serviceName, "Unassigned service")),
      serviceAgent: segmentRows(points, (point) => segmentLabel(point.row.serviceAgentName, "Unassigned service agent")),
      organization: segmentRows(points, (point) => segmentLabel(point.row.organizationName, "Unassigned organization")),
      firstAppointment: segmentRows(points, (point) => firstAppointmentLabel(point.row.firstAppointment)),
      month: segmentRows(points, (point) => point.period),
    },
  };
}
