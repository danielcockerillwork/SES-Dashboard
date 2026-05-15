import { describe, expect, it } from "vitest";
import {
  buildConservaReport,
  hydrateAppointmentsWithContacts,
  hydrateAppointmentsWithFirstAppointmentStatus,
  hydrateAppointmentsWithOrganizations,
  lookupOptionsFromServiceMinderResponses,
  normalizeAppointment,
} from "@/lib/serviceminder/reporting";
import { firstArray, isRecord } from "@/lib/serviceminder/field-access";
import { mockAppointmentPayload } from "@/lib/serviceminder/fixtures";

const appointmentRecords = firstArray(mockAppointmentPayload, ["Appointments"]).filter(isRecord);

describe("Conserva reporting", () => {
  it("normalizes completed appointments with contact.cust_sesscore", () => {
    const row = normalizeAppointment(appointmentRecords[0]);

    expect(row.isCompleted).toBe(true);
    expect(row.customerName).toBe("Jordan Lee");
    expect(row.customFieldNames).toEqual(["SES Score"]);
    expect(row.sesScore?.sourcePath).toBe("contact.cust_sesscore");
    expect(row.sesScore?.numericValue).toBe(92);
    expect(row.hasSesScore).toBe(true);
    expect(row.firstAppointment).toBe(true);
    expect(row.contactVisitCount).toBe(1);
    expect(row.appointmentTotal).toBe(0);
    expect(row.contactLifetimeValue).toBe(1240.5);
    expect(row.appointmentNotes).toContain("Completed controller inspection");
    expect(row.appointmentUrl).toBe("https://serviceminder.com/o/3/appointments/details/710001");
  });

  it("supports lower-case contact path and case-insensitive field access", () => {
    const row = normalizeAppointment({
      AppointmentId: 99,
      DateTime: "2026-05-12T08:30:00-04:00",
      ActualFinish: "2026-05-12T09:30:00-04:00",
      Status: "Complete",
      contact: { cust_sesscore: "95" },
    });

    expect(row.sesScore?.numericValue).toBe(95);
    expect(row.hasSesScore).toBe(true);
  });

  it("ignores non-http appointment links", () => {
    const row = normalizeAppointment({
      AppointmentId: 100,
      Status: "Complete",
      AppointmentUrl: "javascript:alert(1)",
    });

    expect(row.appointmentUrl).toBeNull();
  });

  it("builds the actual ServiceMinder appointment detail URL from contact organization id", () => {
    const row = normalizeAppointment({
      AppointmentId: 41855785,
      DateTime: "5/14/2026 8:35:00 AM",
      ActualStart: "5/14/2026 8:35:00 AM",
      ActualDuration: 50,
      Status: 3,
      TrackingUrl: "https://serviceminder.com/service/schedule/track/not-the-appointment",
      NotificationUri: "https://example.invalid/notify",
      Contact: {
        OrganizationId: 2088,
      },
    });

    expect(row.appointmentUrl).toBe("https://serviceminder.com/o/2088/appointments/details/41855785");
    expect(row.status).toBe("Completed");
  });

  it("extracts SES score from ServiceMinder contact CustomFields arrays", () => {
    const row = normalizeAppointment({
      AppointmentId: 200,
      Status: "Complete",
      ActualFinish: "2026-05-14T09:50:00-04:00",
      Contact: {
        OrganizationId: 2088,
        CustomFields: [
          {
            Id: 10,
            Name: "SES Score",
            Shortcode: "cust_sesscore",
            Value: "98",
            Type: 1,
          },
        ],
      },
    });

    expect(row.hasSesScore).toBe(true);
    expect(row.sesScore?.displayValue).toBe("98");
    expect(row.sesScore?.numericValue).toBe(98);
    expect(row.sesScore?.sourcePath).toBe("Contact.CustomFields[0]");
    expect(row.sesScore?.rawKey).toBe("cust_sesscore");
  });

  it("normalizes appointment notes from nested note payloads", () => {
    const row = normalizeAppointment({
      AppointmentId: 201,
      Status: "Complete",
      ActualFinish: "2026-05-14T09:50:00-04:00",
      Appointment: {
        Notes: [
          { Text: "Checked valve box and replaced damaged cap." },
          { Message: "Customer approved follow-up estimate." },
        ],
      },
    });

    expect(row.appointmentNotes).toBe("Checked valve box and replaced damaged cap.\nCustomer approved follow-up estimate.");
  });

  it("hydrates missing SES score from contact lookup data", async () => {
    const [hydrated] = await hydrateAppointmentsWithContacts(
      [
        {
          AppointmentId: 41855785,
          ContactId: 4051865,
          Status: 3,
          ActualStart: "5/14/2026 8:35:00 AM",
          ActualDuration: 50,
          Contact: {
            OrganizationId: 2088,
            CustomFields: null,
          },
        },
      ],
      {
        async locateContact(contactId) {
          expect(contactId).toBe("4051865");
          return {
            Id: 4051865,
            OrganizationId: 2088,
            CustomFields: [
              {
                Name: "SES Score",
                Shortcode: "cust_sesscore",
                Value: "94",
              },
            ],
          };
        },
      },
    );

    const row = normalizeAppointment(hydrated);
    expect(row.hasSesScore).toBe(true);
    expect(row.sesScore?.displayValue).toBe("94");
    expect(row.sesScore?.sourcePath).toBe("Contact.CustomFields[0]");
    expect(row.appointmentUrl).toBe("https://serviceminder.com/o/2088/appointments/details/41855785");
  });

  it("hydrates missing contact lifetime value from contact lookup data", async () => {
    const [hydrated] = await hydrateAppointmentsWithContacts(
      [
        {
          AppointmentId: 41855786,
          ContactId: 4051866,
          Status: 3,
          ActualStart: "5/14/2026 8:35:00 AM",
          ActualDuration: 50,
          Contact: {
            cust_sesscore: "91",
          },
        },
      ],
      {
        async locateContact(contactId) {
          expect(contactId).toBe("4051866");
          return {
            Id: 4051866,
            LifetimeValue: "$2,500.00",
          };
        },
      },
    );

    const row = normalizeAppointment(hydrated);
    expect(row.hasSesScore).toBe(true);
    expect(row.contactLifetimeValue).toBe(2500);
  });

  it("normalizes contact lifetime value from nested contact custom fields", () => {
    const row = normalizeAppointment({
      AppointmentId: 41855787,
      ContactId: 4051867,
      Status: 3,
      ActualFinish: "2026-05-14T09:50:00-04:00",
      Contact: {
        CustomFields: [
          {
            Name: "Lifetime Value",
            Value: "$3,750.25",
          },
        ],
      },
    });

    expect(row.contactLifetimeValue).toBe(3750.25);
  });

  it("normalizes contact lifetime value from nested contact totals", () => {
    const row = normalizeAppointment({
      AppointmentId: 41855788,
      ContactId: 4051868,
      Status: 3,
      ActualFinish: "2026-05-14T09:50:00-04:00",
      Contact: {
        Accounting: {
          TotalRevenue: "$4,100.00",
        },
      },
    });

    expect(row.contactLifetimeValue).toBe(4100);
  });

  it("hydrates organization names from the API-key organization directory", () => {
    const [hydrated] = hydrateAppointmentsWithOrganizations(
      [
        {
          AppointmentId: 41855785,
          OrganizationId: 2088,
          Status: "Complete",
          ActualFinish: "2026-05-14T09:50:00-04:00",
        },
      ],
      {
        Organizations: [
          {
            OrganizationId: 2088,
            Name: "Conserva Greenville",
          },
        ],
      },
    );

    const row = normalizeAppointment(hydrated);
    expect(row.organizationName).toBe("Conserva Greenville");
    expect(row.appointmentUrl).toBe("https://serviceminder.com/o/2088/appointments/details/41855785");
  });

  it("uses the single API-key organization when appointments omit organization fields", () => {
    const [hydrated] = hydrateAppointmentsWithOrganizations(
      [
        {
          AppointmentId: 41855785,
          Status: "Complete",
          ActualFinish: "2026-05-14T09:50:00-04:00",
        },
      ],
      {
        Organizations: [
          {
            OrganizationId: 2088,
            PublicName: "Conserva Greenville",
          },
        ],
      },
    );

    const row = normalizeAppointment(hydrated);
    expect(row.organizationId).toBe("2088");
    expect(row.organizationName).toBe("Conserva Greenville");
  });

  it("builds lookup options from direct ServiceMinder lookup API responses", () => {
    const options = lookupOptionsFromServiceMinderResponses({
      serviceAgentsResponse: {
        ServiceAgents: [
          { ServiceAgentId: 2, Name: "Mina Patel" },
          { ServiceAgentId: 1, FullName: "Alex Rivera" },
        ],
      },
      servicesResponse: {
        Services: [{ Name: "Irrigation Inspection" }, { ServiceName: "Controller Audit" }],
      },
      organizationsResponse: {
        Organizations: [{ OrganizationId: 2088, PublicName: "Conserva Greenville" }],
      },
    });

    expect(options.serviceAgents).toEqual([
      { id: "1", name: "Alex Rivera" },
      { id: "2", name: "Mina Patel" },
    ]);
    expect(options.services).toEqual([{ name: "Controller Audit" }, { name: "Irrigation Inspection" }]);
    expect(options.organizations).toEqual([{ name: "Conserva Greenville" }]);
  });

  it("looks back by contact to compute first appointment status", async () => {
    const calls: Array<{ contactId: string | number | undefined; fromDate: string; throughDate: string }> = [];
    const hydrated = await hydrateAppointmentsWithFirstAppointmentStatus(
      [
        {
          AppointmentId: 11,
          ContactId: 501,
          DateTime: "2026-05-10T09:00:00-04:00",
          ActualFinish: "2026-05-10T10:00:00-04:00",
          Status: "Complete",
          FirstAppointment: true,
        },
        {
          AppointmentId: 12,
          ContactId: 502,
          DateTime: "2026-05-12T09:00:00-04:00",
          ActualFinish: "2026-05-12T10:00:00-04:00",
          Status: "Complete",
          FirstAppointment: false,
        },
      ],
      {
        async queryAppointments(params) {
          calls.push({
            contactId: params.contactId,
            fromDate: params.fromDate,
            throughDate: params.throughDate,
          });
          return {
            items:
              params.contactId === "501"
                ? [
                    {
                      AppointmentId: 1,
                      ContactId: 501,
                      DateTime: "2026-04-01T09:00:00-04:00",
                    },
                  ]
                : [
                    {
                      AppointmentId: 12,
                      ContactId: 502,
                      DateTime: "2026-05-12T09:00:00-04:00",
                    },
                  ],
            rawResponses: [],
            totalCount: null,
            warning: null,
          };
        },
      },
    );

    const rows = hydrated.map(normalizeAppointment);
    expect(rows.map((row) => row.firstAppointment)).toEqual([false, true]);
    expect(rows.map((row) => row.contactVisitCount)).toEqual([2, 1]);
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(
      expect.arrayContaining([
        { contactId: "501", fromDate: "1900-01-01", throughDate: "2026-05-10" },
        { contactId: "502", fromDate: "1900-01-01", throughDate: "2026-05-12" },
      ]),
    );
  });

  it("summarizes completed appointments, SES score coverage, and appointment status metrics", () => {
    const report = buildConservaReport(
      appointmentRecords,
      {
        from: "2026-05-01",
        through: "2026-05-31",
      },
      "mock",
      [mockAppointmentPayload],
    );

    expect(report.rows).toHaveLength(6);
    expect(report.summary.completedAppointments).toBe(6);
    expect(report.summary.appointmentsWithSesScore).toBe(4);
    expect(report.summary.missingSesScore).toBe(2);
    expect(report.summary.averageSesScore).toBeCloseTo(86.75, 2);
    expect(report.summary.firstAppointments).toBe(2);
    expect(report.summary.firstAppointmentsWithSesScore).toBe(2);
    expect(report.summary.firstAppointmentSesScoreCoverageRate).toBe(100);
    expect(report.summary.totalAppointmentValue).toBe(520);
    expect(report.scoreTrends.length).toBeGreaterThan(0);
  });

  it("sorts report rows by newest appointment date first", () => {
    const report = buildConservaReport(
      [
        {
          AppointmentId: 1,
          DateTime: "2026-05-03T09:00:00-04:00",
          Status: 3,
        },
        {
          AppointmentId: 2,
          DateTime: "2026-05-10T09:00:00-04:00",
          Status: 3,
        },
        {
          AppointmentId: 3,
          Status: 3,
        },
      ],
      {
        from: "",
        through: "",
      },
      "mock",
    );

    expect(report.rows.map((row) => row.id)).toEqual(["2", "1", "3"]);
  });

  it("can build a missing SES score queue", () => {
    const report = buildConservaReport(
      appointmentRecords,
      {
        from: "2026-05-01",
        through: "2026-05-31",
        missingSesScore: true,
      },
      "mock",
      [mockAppointmentPayload],
    );

    expect(report.rows).toHaveLength(2);
    expect(report.rows.every((row) => !row.hasSesScore)).toBe(true);
  });

  it("filters report rows by appointment date range", () => {
    const report = buildConservaReport(
      appointmentRecords,
      {
        from: "2026-05-10",
        through: "2026-05-31",
      },
      "mock",
      [mockAppointmentPayload],
    );

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].id).toBe("710006");
    expect(report.summary.completedAppointments).toBe(1);
  });

  it("keeps report summaries aligned with service agent filters", () => {
    const report = buildConservaReport(
      appointmentRecords,
      {
        from: "2026-05-01",
        through: "2026-05-31",
        serviceAgentName: "Mina Patel",
      },
      "mock",
      [mockAppointmentPayload],
    );

    expect(report.rows).toHaveLength(2);
    expect(report.rows.every((row) => row.serviceAgentName === "Mina Patel")).toBe(true);
    expect(report.summary.completedAppointments).toBe(2);
    expect(report.summary.averageSesScore).toBeCloseTo(90.5, 2);
    expect(report.summary.firstAppointments).toBe(1);
    expect(report.summary.totalAppointmentValue).toBe(355);
  });

  it("filters report rows by several selected services", () => {
    const report = buildConservaReport(
      appointmentRecords,
      {
        from: "2026-05-01",
        through: "2026-05-31",
        serviceTypes: ["Controller Audit", "Repair Visit"],
      },
      "mock",
      [mockAppointmentPayload],
    );

    expect(report.rows).toHaveLength(3);
    expect(new Set(report.rows.map((row) => row.serviceName))).toEqual(new Set(["Controller Audit", "Repair Visit"]));
  });
});
