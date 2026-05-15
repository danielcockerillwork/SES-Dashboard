import { describe, expect, it } from "vitest";
import { buildSesValueAnalytics, type AnalyticsAppointmentRow } from "@/lib/serviceminder/analytics";

function row({
  id,
  score,
  value,
  serviceName = "Inspection",
  serviceAgentName = "Alex Rivera",
  organizationName = "Conserva Charleston",
  firstAppointment = false,
  completedDate = "2026-05-01T10:00:00-04:00",
}: {
  id: string;
  score: number | null;
  value: number | null;
  serviceName?: string | null;
  serviceAgentName?: string | null;
  organizationName?: string | null;
  firstAppointment?: boolean | null;
  completedDate?: string | null;
}): AnalyticsAppointmentRow {
  return {
    id,
    appointmentUrl: null,
    appointmentDate: null,
    completedDate,
    customerName: `Customer ${id}`,
    serviceName,
    serviceAgentName,
    organizationName,
    appointmentTotal: value,
    firstAppointment,
    sesScore:
      score === null
        ? null
        : {
            name: "SES Score",
            normalizedName: "ses score",
            value: score,
            displayValue: String(score),
            valueType: "number",
            numericValue: score,
            scoreLike: true,
            sourcePath: "contact.cust_sesscore",
            rawKey: "cust_sesscore",
          },
  };
}

describe("SES value analytics", () => {
  it("builds SES bands and excludes incomplete numeric rows from analysis", () => {
    const analytics = buildSesValueAnalytics([
      row({ id: "1", score: 65, value: 100 }),
      row({ id: "2", score: 75, value: 200 }),
      row({ id: "3", score: 85, value: 300 }),
      row({ id: "4", score: 95, value: 400 }),
      row({ id: "5", score: null, value: 500 }),
      row({ id: "6", score: 90, value: null }),
    ]);

    expect(analytics.analyzableRows).toBe(4);
    expect(analytics.highTicketThreshold).toBe(300);
    expect(analytics.bands.map((band) => [band.label, band.count])).toEqual([
      ["<70", 1],
      ["70-79", 1],
      ["80-89", 1],
      ["90+", 1],
    ]);
    expect(analytics.bands.find((band) => band.label === "<70")?.percentOfAnalyzable).toBe(25);
    expect(analytics.averageValue).toBe(250);
  });

  it("keeps zero-dollar tickets analyzable but excludes them from the high-ticket threshold", () => {
    const analytics = buildSesValueAnalytics([
      row({ id: "1", score: 60, value: 0 }),
      row({ id: "2", score: 72, value: 50 }),
      row({ id: "3", score: 88, value: 100 }),
      row({ id: "4", score: 94, value: 200 }),
    ]);

    expect(analytics.analyzableRows).toBe(4);
    expect(analytics.averageValue).toBe(87.5);
    expect(analytics.highTicketThreshold).toBe(200);
  });

  it("identifies low-score high-ticket outliers sorted by value then lower score", () => {
    const analytics = buildSesValueAnalytics([
      row({ id: "high-low-1", score: 79, value: 500 }),
      row({ id: "high-low-2", score: 65, value: 500 }),
      row({ id: "high-ok", score: 90, value: 600 }),
      row({ id: "low-ticket", score: 60, value: 100 }),
      row({ id: "mid-ticket", score: 85, value: 300 }),
    ]);

    expect(analytics.highTicketThreshold).toBe(500);
    expect(analytics.outliers.map((point) => point.row.id)).toEqual(["high-low-2", "high-low-1"]);
    expect(analytics.outliers.every((point) => point.lowScore && point.highTicket)).toBe(true);
  });

  it("calculates Pearson correlation and returns null when variance is missing", () => {
    const positive = buildSesValueAnalytics([
      row({ id: "1", score: 70, value: 100 }),
      row({ id: "2", score: 80, value: 200 }),
      row({ id: "3", score: 90, value: 300 }),
    ]);
    const noScoreVariance = buildSesValueAnalytics([
      row({ id: "1", score: 80, value: 100 }),
      row({ id: "2", score: 80, value: 200 }),
    ]);

    expect(positive.correlation).toBeCloseTo(1, 6);
    expect(noScoreVariance.correlation).toBeNull();
  });

  it("aggregates service, agent, organization, first-appointment, and month segments", () => {
    const analytics = buildSesValueAnalytics([
      row({
        id: "1",
        score: 70,
        value: 500,
        serviceName: "Repair",
        serviceAgentName: "Mina Patel",
        organizationName: "Conserva Savannah",
        firstAppointment: true,
        completedDate: "2026-04-15T12:00:00-04:00",
      }),
      row({
        id: "2",
        score: 95,
        value: 100,
        serviceName: "Audit",
        serviceAgentName: "Alex Rivera",
        organizationName: "Conserva Charleston",
        firstAppointment: false,
        completedDate: "2026-05-01T12:00:00-04:00",
      }),
      row({
        id: "3",
        score: 60,
        value: 600,
        serviceName: "Repair",
        serviceAgentName: "Mina Patel",
        organizationName: "Conserva Savannah",
        firstAppointment: true,
        completedDate: "2026-05-02T12:00:00-04:00",
      }),
    ]);

    expect(analytics.segments.service[0]).toMatchObject({
      label: "Repair",
      count: 2,
      outlierCount: 1,
      lowScoreCount: 2,
      totalValue: 1100,
    });
    expect(analytics.segments.serviceAgent[0].label).toBe("Mina Patel");
    expect(analytics.segments.organization[0].label).toBe("Conserva Savannah");
    expect(analytics.segments.firstAppointment[0]).toMatchObject({ label: "First appointment", count: 2 });
    expect(analytics.segments.month.map((segment) => segment.label).sort()).toEqual(["2026-04", "2026-05"]);
  });
});
