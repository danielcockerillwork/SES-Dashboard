import { describe, expect, it } from "vitest";
import {
  organizationFromOrganizationsResponse,
  resolveCurrentServiceMinderOrganization,
} from "@/lib/serviceminder/identity";
import type { ServiceMinderClient } from "@/lib/serviceminder/client";

describe("ServiceMinder organization identity", () => {
  it("reads a single organization from an organizations response", () => {
    const organization = organizationFromOrganizationsResponse({
      Organizations: [{ OrganizationId: 2088, PublicName: "Conserva Greenville" }],
    });

    expect(organization).toMatchObject({
      id: "2088",
      name: "Conserva Greenville",
      displayName: "Conserva Greenville",
      source: "organizations",
    });
  });

  it("falls back to appointment organization id when organization endpoints are unavailable", async () => {
    const client = {
      async queryAppointments() {
        return {
          items: [
            {
              AppointmentId: 41855785,
              Contact: {
                OrganizationId: 2088,
              },
            },
          ],
          rawResponses: [],
          totalCount: 1,
          warning: null,
        };
      },
      async organizationDetails() {
        throw new Error("not allowed");
      },
    } as unknown as ServiceMinderClient;

    const organization = await resolveCurrentServiceMinderOrganization(client, { organizationsResponse: null });

    expect(organization).toMatchObject({
      id: "2088",
      name: null,
      displayName: "Organization 2088",
      source: "appointments",
    });
  });

  it("uses organization details to upgrade an appointment organization id to a name", async () => {
    const client = {
      async queryAppointments() {
        return {
          items: [
            {
              AppointmentId: 41855785,
              Contact: {
                OrganizationId: 2088,
              },
            },
          ],
          rawResponses: [],
          totalCount: 1,
          warning: null,
        };
      },
      async organizationDetails() {
        return { OrganizationId: 2088, Name: "Conserva Greenville" };
      },
    } as unknown as ServiceMinderClient;

    const organization = await resolveCurrentServiceMinderOrganization(client, { organizationsResponse: null });

    expect(organization).toMatchObject({
      id: "2088",
      name: "Conserva Greenville",
      displayName: "Conserva Greenville",
      source: "organization-details",
    });
  });
});
