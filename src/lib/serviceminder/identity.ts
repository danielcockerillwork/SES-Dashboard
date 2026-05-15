import { firstArray, isRecord, readField, stringField, type RawRecord } from "@/lib/serviceminder/field-access";
import type { ServiceMinderClient } from "@/lib/serviceminder/client";

export type ServiceMinderOrganizationIdentity = {
  id: string | null;
  name: string | null;
  displayName: string | null;
  source: "organizations" | "organization-details" | "appointments" | "unavailable";
};

const ORGANIZATION_RECORD_ID_CANDIDATES = [
  "OrganizationId",
  "OrganizationID",
  "Id",
  "ID",
  "Organization.Id",
  "Organization.ID",
  "LocationId",
];

const ORGANIZATION_RECORD_NAME_CANDIDATES = [
  "Name",
  "PublicName",
  "OrganizationName",
  "InternalName",
  "LegalEntityName",
  "LocationName",
];

const APPOINTMENT_ORGANIZATION_ID_CANDIDATES = [
  ...ORGANIZATION_RECORD_ID_CANDIDATES,
  "Contact.OrganizationId",
  "Contact.OrganizationID",
  "Contact.OrgId",
  "Contact.OrgID",
];

const APPOINTMENT_ORGANIZATION_NAME_CANDIDATES = [
  ...ORGANIZATION_RECORD_NAME_CANDIDATES,
  "Organization.Name",
  "Organization.PublicName",
  "Contact.OrganizationName",
  "Contact.Organization.Name",
  "Contact.Organization.PublicName",
];

const ORGANIZATION_RESPONSE_COLLECTIONS = ["Organizations", "organizations", "Matches", "Items", "Results"];
const ORGANIZATION_DETAIL_RECORD_CANDIDATES = ["Organization", "organization", "Result", "Item"];
const KNOWN_ORGANIZATION_NAMES = new Map([["2088", "Conserva of South NJ"]]);

function knownOrganizationName(id: string | null) {
  return id ? KNOWN_ORGANIZATION_NAMES.get(id) ?? null : null;
}

function displayName(id: string | null, name: string | null) {
  return name ?? knownOrganizationName(id) ?? (id ? `Organization ${id}` : null);
}

function identity(
  id: string | null,
  name: string | null,
  source: ServiceMinderOrganizationIdentity["source"],
): ServiceMinderOrganizationIdentity {
  return {
    id,
    name,
    displayName: displayName(id, name),
    source,
  };
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function organizationFromRecord(record: RawRecord, source: ServiceMinderOrganizationIdentity["source"]) {
  const id = stringField(record, ORGANIZATION_RECORD_ID_CANDIDATES);
  const name = stringField(record, ORGANIZATION_RECORD_NAME_CANDIDATES) ?? knownOrganizationName(id);
  if (!id && !name) return null;
  return identity(id, name, source);
}

function organizationFromAppointment(record: RawRecord) {
  const id = stringField(record, APPOINTMENT_ORGANIZATION_ID_CANDIDATES);
  const name = stringField(record, APPOINTMENT_ORGANIZATION_NAME_CANDIDATES) ?? knownOrganizationName(id);
  if (!id && !name) return null;
  return identity(id, name, "appointments");
}

export function organizationFromOrganizationsResponse(response: unknown) {
  const records = firstArray(response, ORGANIZATION_RESPONSE_COLLECTIONS).filter(isRecord);
  if (records.length !== 1) return null;
  return organizationFromRecord(records[0], "organizations");
}

async function organizationDetails(client: ServiceMinderClient, organizationId: string) {
  const details = await client.organizationDetails(organizationId).catch(() => null);
  if (!isRecord(details)) return null;

  const direct = organizationFromRecord(details, "organization-details");
  if (direct?.name) return direct;

  for (const candidate of ORGANIZATION_DETAIL_RECORD_CANDIDATES) {
    const nested = readField(details, [candidate]);
    const nestedIdentity = organizationFromRecord(isRecord(nested) ? nested : {}, "organization-details");
    if (nestedIdentity?.name) return nestedIdentity;
  }

  const collectionRecord = firstArray(details, ORGANIZATION_RESPONSE_COLLECTIONS).find(isRecord);
  const collectionIdentity = organizationFromRecord(collectionRecord ?? {}, "organization-details");
  if (collectionIdentity?.name) return collectionIdentity;

  return direct;
}

async function organizationFromRecentAppointments(client: ServiceMinderClient) {
  for (const days of [30, 180, 365]) {
    const response = await client
      .queryAppointments({
        fromDate: dateDaysAgo(days),
        throughDate: today(),
        includeContact: true,
        includeCompleted: true,
        take: 1,
        maxRecords: 1,
      })
      .catch(() => null);
    const appointment = response?.items.find(isRecord);
    if (!appointment) continue;

    const appointmentIdentity = organizationFromAppointment(appointment);
    if (!appointmentIdentity) continue;

    if (appointmentIdentity.id) {
      const detailsIdentity = await organizationDetails(client, appointmentIdentity.id);
      if (detailsIdentity?.name) return detailsIdentity;
    }

    return appointmentIdentity;
  }

  return null;
}

export async function resolveCurrentServiceMinderOrganization(
  client: ServiceMinderClient,
  options: { organizationsResponse?: unknown } = {},
): Promise<ServiceMinderOrganizationIdentity> {
  const providedOrganization = organizationFromOrganizationsResponse(options.organizationsResponse);
  if (providedOrganization?.name) return providedOrganization;

  if (!("organizationsResponse" in options)) {
    const organizationsResponse = await client.organizations().catch(() => null);
    const organization = organizationFromOrganizationsResponse(organizationsResponse);
    if (organization?.name) return organization;
  }

  const appointmentOrganization = await organizationFromRecentAppointments(client);
  return appointmentOrganization ?? identity(null, null, "unavailable");
}
