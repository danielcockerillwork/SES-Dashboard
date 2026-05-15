import { describe, expect, it } from "vitest";
import { ServiceMinderClient } from "@/lib/serviceminder/client";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ServiceMinderClient", () => {
  it("pages appointment queries and includes completed appointments", async () => {
    const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];
    const client = new ServiceMinderClient({
      baseUrl: "https://serviceminder.com/api",
      apiKey: "secret-key",
      fetcher: async (input, init) => {
        const payload = JSON.parse(String(init?.body));
        calls.push({ url: String(input), payload });
        if (payload.Skip === 0) {
          return response({ ResultCode: 0, Count: 3, Appointments: [{ AppointmentId: 1 }, { AppointmentId: 2 }] });
        }
        return response({ ResultCode: 0, Count: 3, Appointments: [{ AppointmentId: 3 }] });
      },
    });

    const result = await client.queryAppointments({
      fromDate: "2026-05-01",
      throughDate: "2026-05-31",
      take: 2,
    });

    expect(result.items.map((item) => item.AppointmentId)).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://serviceminder.com/api/appointments/query");
    expect(calls[0].payload).toMatchObject({
      FromDate: "2026-05-01",
      ThroughDate: "2026-05-31",
      IncludeContact: true,
      IncludeCompleted: true,
      Skip: 0,
      Take: 2,
      ApiKey: "secret-key",
    });
    expect(calls[1].payload.Skip).toBe(2);
  });

  it("can scope appointment queries to one contact for history lookups", async () => {
    const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];
    const client = new ServiceMinderClient({
      baseUrl: "https://serviceminder.com/api",
      apiKey: "secret-key",
      fetcher: async (input, init) => {
        const payload = JSON.parse(String(init?.body));
        calls.push({ url: String(input), payload });
        return response({ ResultCode: 0, Count: 0, Appointments: [] });
      },
    });

    await client.queryAppointments({
      fromDate: "1900-01-01",
      throughDate: "2026-05-10",
      contactId: "501",
      includeContact: false,
      take: 50,
    });

    expect(calls[0].payload).toMatchObject({
      FromDate: "1900-01-01",
      ThroughDate: "2026-05-10",
      ContactId: 501,
      IncludeContact: false,
      IncludeCompleted: true,
      ApiKey: "secret-key",
    });
  });

  it("queries organizations for the current API key", async () => {
    const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];
    const client = new ServiceMinderClient({
      baseUrl: "https://serviceminder.com/api",
      apiKey: "secret-key",
      fetcher: async (input, init) => {
        const payload = JSON.parse(String(init?.body));
        calls.push({ url: String(input), payload });
        return response({ ResultCode: 0, Organizations: [{ OrganizationId: 2088, Name: "Conserva Greenville" }] });
      },
    });

    await client.organizations();

    expect(calls[0].url).toBe("https://serviceminder.com/api/organizations/query");
    expect(calls[0].payload).toMatchObject({
      PublicName: "",
      InternalName: "",
      LocationId: "",
      PostalCode: "",
      IncludeInactive: false,
      ApiKey: "secret-key",
    });
  });

  it("requests organization details by id", async () => {
    const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];
    const client = new ServiceMinderClient({
      baseUrl: "https://serviceminder.com/api",
      apiKey: "secret-key",
      fetcher: async (input, init) => {
        const payload = JSON.parse(String(init?.body));
        calls.push({ url: String(input), payload });
        return response({ ResultCode: 0, OrganizationId: 2088, PublicName: "Conserva Greenville" });
      },
    });

    await client.organizationDetails("2088");

    expect(calls[0].url).toBe("https://serviceminder.com/api/organizations/details");
    expect(calls[0].payload).toMatchObject({
      OrganizationId: 2088,
      ApiKey: "secret-key",
    });
  });

  it("locates contacts by id for contact custom fields", async () => {
    const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];
    const client = new ServiceMinderClient({
      baseUrl: "https://serviceminder.com/api",
      apiKey: "secret-key",
      fetcher: async (input, init) => {
        const payload = JSON.parse(String(init?.body));
        calls.push({ url: String(input), payload });
        return response({
          ResultCode: 0,
          Matches: [
            {
              Id: 4051865,
              CustomFields: [{ Name: "SES Score", Shortcode: "cust_sesscore", Value: "94" }],
            },
          ],
        });
      },
    });

    const contact = await client.locateContact("4051865");

    expect(contact?.Id).toBe(4051865);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://serviceminder.com/api/contacts/locate");
    expect(calls[0].payload).toMatchObject({
      IdSearch: 4051865,
      NameSearch: "",
      PhoneSearch: "",
      EmailSearch: "",
      AddressSearch: "",
      DigitalTrackingIdSearch: "",
      ReturnPmtOnFile: false,
      DistributeLead: false,
      Skip: 0,
      Limit: 1,
      ApiKey: "secret-key",
    });
  });

  it("retries transient ServiceMinder timeout responses", async () => {
    const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];
    const client = new ServiceMinderClient({
      baseUrl: "https://serviceminder.com/api",
      apiKey: "secret-key",
      retryAttempts: 2,
      retryDelayMs: 0,
      fetcher: async (input, init) => {
        const payload = JSON.parse(String(init?.body));
        calls.push({ url: String(input), payload });
        if (calls.length < 3) return response({ Message: "<none>" }, 522);
        return response({ ResultCode: 0, Count: 1, Appointments: [{ AppointmentId: 1 }] });
      },
    });

    const result = await client.queryAppointments({
      fromDate: "2026-05-01",
      throughDate: "2026-05-31",
      take: 2,
    });

    expect(result.items.map((item) => item.AppointmentId)).toEqual([1]);
    expect(calls).toHaveLength(3);
    expect(result.warning).toBeNull();
  });

  it("returns partial live appointment pages when a later page times out", async () => {
    const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];
    const client = new ServiceMinderClient({
      baseUrl: "https://serviceminder.com/api",
      apiKey: "secret-key",
      retryAttempts: 0,
      fetcher: async (input, init) => {
        const payload = JSON.parse(String(init?.body));
        calls.push({ url: String(input), payload });
        if (payload.Skip === 0) {
          return response({ ResultCode: 0, Count: 3, Appointments: [{ AppointmentId: 1 }, { AppointmentId: 2 }] });
        }
        return response({ Message: "<none>" }, 522);
      },
    });

    const result = await client.queryAppointments({
      fromDate: "2026-05-01",
      throughDate: "2026-05-31",
      take: 2,
    });

    expect(result.items.map((item) => item.AppointmentId)).toEqual([1, 2]);
    expect(result.warning).toContain("ServiceMinder HTTP 522");
    expect(result.warning).toContain("Returned 2 live rows");
    expect(calls).toHaveLength(2);
  });
});
