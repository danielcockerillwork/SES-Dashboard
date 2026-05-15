import { Prisma } from "@prisma/client";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import { getDecryptedApiKey, getSettings } from "@/lib/settings";
import { redactSecrets } from "@/lib/security";
import {
  appointmentCacheRecordKey,
  readCachedCompletedAppointments,
  serviceMinderAppointmentCacheContext,
  writeCachedCompletedAppointments,
  type AppointmentCacheRecord,
} from "@/lib/serviceminder/appointment-cache";
import { displayCustomFieldValue, extractCustomFields, summarizeFieldValues } from "@/lib/serviceminder/custom-fields";
import { ServiceMinderClient } from "@/lib/serviceminder/client";
import {
  booleanField,
  dateField,
  firstArray,
  isRecord,
  numberField,
  readField,
  stringField,
  type RawRecord,
} from "@/lib/serviceminder/field-access";
import { mockAppointmentPayload } from "@/lib/serviceminder/fixtures";
import type {
  ConservaAppointmentRow,
  ConservaReportFilters,
  ConservaReportResult,
  ConservaReportSummary,
  CustomFieldValue,
  ScoreTrendPoint,
} from "@/lib/serviceminder/types";

export const SES_SCORE_FIELD_NAME = "SES Score";
export const SES_SCORE_FIELD_PATH = "contact.cust_sesscore";

const SES_SCORE_CANDIDATES = [
  "contact.cust_sesscore",
  "Contact.cust_sesscore",
  "Contact.Cust_SESScore",
  "Contact.cust_SESScore",
  "Contact.Cust_SESScore.Value",
  "Contact.CustomFields.cust_sesscore",
  "cust_sesscore",
  "Cust_SESScore",
  "cust_SESScore",
];

const APPOINTMENT_URL_CANDIDATES = [
  "AppointmentUrl",
  "AppointmentURL",
  "AppointmentLink",
  "Appointment.Link",
  "Appointment.Url",
  "Appointment.URL",
  "DetailUrl",
  "DetailURL",
  "DetailsUrl",
  "DetailsURL",
  "WebUrl",
  "WebURL",
  "Url",
  "URL",
  "Link",
  "Href",
  "DeepLink",
];

const ORGANIZATION_ID_CANDIDATES = [
  "OrganizationId",
  "OrganizationID",
  "OrgId",
  "OrgID",
  "Organization.Id",
  "Organization.ID",
  "Contact.OrganizationId",
  "Contact.OrganizationID",
  "Contact.OrgId",
  "Contact.OrgID",
];

const ORGANIZATION_NAME_CANDIDATES = [
  "OrganizationName",
  "Organization.Name",
  "Organization.PublicName",
  "OrgName",
  "LocationName",
  "Location.Name",
];

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
  "LocationId",
];

const SERVICE_AGENT_RECORD_ID_CANDIDATES = [
  "Id",
  "ID",
  "ServiceAgentId",
  "ServiceAgentID",
  "TechnicianId",
  "TechnicianID",
];

const SERVICE_AGENT_RECORD_NAME_CANDIDATES = [
  "Name",
  "FullName",
  "DisplayName",
  "ServiceAgentName",
  "TechnicianName",
];

const SERVICE_RECORD_NAME_CANDIDATES = ["Name", "ServiceName", "Description", "Label"];

const APPOINTMENT_ID_CANDIDATES = ["AppointmentId", "AppointmentID", "Id", "ID", "Appointment.Id", "Appointment.ID"];
const CONTACT_ID_CANDIDATES = ["ContactId", "ContactID", "Contact.Id", "Contact.ID"];
const APPOINTMENT_DATE_CANDIDATES = ["DateTime", "ScheduledStart", "Start", "StartDate", "Date"];
const SES_SCORE_IDENTIFIERS = new Set(["sesscore", "custsesscore"]);
const CONTACT_LIFETIME_VALUE_IDENTIFIERS = new Set([
  "contactlifetimevalue",
  "customerlifetimevalue",
  "clientlifetimevalue",
  "lifetimevalue",
  "ltv",
]);
const APPOINTMENT_NOTE_CANDIDATES = [
  "AppointmentNotes",
  "Appointment.Notes",
  "Appointment.Note",
  "Notes",
  "Note",
  "TechnicianNotes",
  "TechNotes",
  "ServiceNotes",
  "CompletionNotes",
  "WorkPerformed",
  "Work Performed",
  "Summary",
  "Description",
  "Comments",
  "Comment",
  "PrivateNotes",
  "InternalNotes",
];

type ContactLocator = Pick<ServiceMinderClient, "locateContact">;
type AppointmentHistoryLocator = Pick<ServiceMinderClient, "queryAppointments">;

type OrganizationDirectory = {
  byId: Map<string, RawRecord>;
  single: RawRecord | null;
};

type LookupOptionResponses = {
  serviceAgentsResponse?: unknown;
  servicesResponse?: unknown;
  organizationsResponse?: unknown;
};

type ConservaReportOptions = {
  refreshCache?: boolean;
};

function actualFinishDate(raw: RawRecord) {
  const explicit = dateField(raw, [
    "CompletedDate",
    "CompletionDate",
    "ActualFinish",
    "FinishedAt",
    "DateCompleted",
  ]);
  if (explicit) return explicit;

  const actualStart = dateField(raw, ["ActualStart"]);
  const actualDuration = numberField(raw, ["ActualDuration"]);
  if (!actualStart || actualDuration === null) return null;

  const startDate = new Date(actualStart);
  if (Number.isNaN(startDate.getTime())) return null;
  return new Date(startDate.getTime() + actualDuration * 60_000).toISOString();
}

function contactName(raw: RawRecord) {
  const direct = stringField(raw, [
    "CustomerName",
    "ContactName",
    "ClientName",
    "Name",
    "Contact.Name",
    "Contact.FullName",
    "Contact.DisplayName",
    "Contact.Company",
  ]);
  if (direct) return direct;

  const first = stringField(raw, ["Contact.FirstName", "Contact.First"]);
  const last = stringField(raw, ["Contact.LastName", "Contact.Last"]);
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

function completedState(raw: RawRecord) {
  const status = stringField(raw, ["Status", "AppointmentStatus", "State"]);
  if (status && /complete|finished|done|closed/i.test(status)) return true;
  const numericStatus = numberField(raw, ["Status", "AppointmentStatus"]);
  if (numericStatus === 3) return true;
  return Boolean(actualFinishDate(raw));
}

function appointmentStatus(raw: RawRecord) {
  const numericStatus = numberField(raw, ["Status", "AppointmentStatus"]);
  if (numericStatus === 3) return "Completed";

  const status = stringField(raw, ["Status", "AppointmentStatus", "State"]);
  if (!status) return null;
  return /^complete$/i.test(status) ? "Completed" : status;
}

function appointmentSortTime(row: ConservaAppointmentRow) {
  const value = row.appointmentDate ?? row.completedDate;
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function compareRowsByAppointmentDateDesc(left: ConservaAppointmentRow, right: ConservaAppointmentRow) {
  const leftTime = appointmentSortTime(left);
  const rightTime = appointmentSortTime(right);

  if (leftTime === null && rightTime === null) return 0;
  if (leftTime === null) return 1;
  if (rightTime === null) return -1;
  return rightTime - leftTime;
}

function valueType(value: unknown): CustomFieldValue["valueType"] {
  if (value === null || value === undefined || value === "") return "blank";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  return "text";
}

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fraction = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (fraction) {
    const parsed = Number(fraction[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const normalized = trimmed.replace(/[$,% ,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateKey(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizedIdentifier(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
}

function pathText(parts: string[]) {
  return parts.join(".");
}

function organizationId(raw: RawRecord) {
  return stringField(raw, ORGANIZATION_ID_CANDIDATES);
}

function organizationName(raw: RawRecord) {
  return stringField(raw, ORGANIZATION_NAME_CANDIDATES);
}

function organizationRecordId(raw: RawRecord) {
  return stringField(raw, ORGANIZATION_RECORD_ID_CANDIDATES);
}

function organizationRecordName(raw: RawRecord) {
  return stringField(raw, ORGANIZATION_RECORD_NAME_CANDIDATES);
}

function serviceAgentRecordId(raw: RawRecord) {
  return stringField(raw, SERVICE_AGENT_RECORD_ID_CANDIDATES);
}

function serviceAgentRecordName(raw: RawRecord) {
  return stringField(raw, SERVICE_AGENT_RECORD_NAME_CANDIDATES);
}

function serviceRecordName(raw: RawRecord) {
  return stringField(raw, SERVICE_RECORD_NAME_CANDIDATES);
}

function appointmentId(raw: RawRecord) {
  return stringField(raw, APPOINTMENT_ID_CANDIDATES);
}

function contactId(raw: RawRecord) {
  return stringField(raw, CONTACT_ID_CANDIDATES);
}

function appointmentDate(raw: RawRecord) {
  return dateField(raw, APPOINTMENT_DATE_CANDIDATES);
}

function isSesScoreCustomField(field: CustomFieldValue) {
  const identifiers = [field.name, field.normalizedName, field.rawKey, field.sourcePath].map(normalizedIdentifier);
  return identifiers.some((identifier) => SES_SCORE_IDENTIFIERS.has(identifier) || identifier.endsWith("custsesscore"));
}

function sesScoreField(raw: RawRecord): CustomFieldValue | null {
  const value = readField(raw, SES_SCORE_CANDIDATES);
  if (value === undefined || value === null || value === "") return null;
  const numeric = numericValue(value);

  return {
    name: SES_SCORE_FIELD_NAME,
    normalizedName: SES_SCORE_FIELD_NAME.toLowerCase(),
    value,
    displayValue: displayCustomFieldValue(value),
    valueType: valueType(value),
    numericValue: numeric,
    scoreLike: numeric !== null,
    sourcePath: SES_SCORE_FIELD_PATH,
    rawKey: "cust_sesscore",
  };
}

function sesScoreFromCustomFields(customFields: CustomFieldValue[]): CustomFieldValue | null {
  const field = customFields.find((candidate) => {
    if (!isSesScoreCustomField(candidate)) return false;
    return candidate.value !== undefined && candidate.value !== null && candidate.value !== "";
  });
  if (!field) return null;

  return {
    ...field,
    name: SES_SCORE_FIELD_NAME,
    normalizedName: SES_SCORE_FIELD_NAME.toLowerCase(),
    scoreLike: field.numericValue !== null,
    rawKey: field.rawKey ?? "cust_sesscore",
  };
}

function isoWeekNumber(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function appointmentTotal(raw: RawRecord) {
  return numberField(raw, [
    "Total",
    "AppointmentTotal",
    "Appointment.Total",
    "JobTotal",
    "Amount",
    "Price",
    "InvoiceTotal",
    "Invoice.Total",
  ]);
}

function contactLifetimeValue(raw: RawRecord) {
  return (
    numberField(raw, [
      "ContactLifetimeValue",
      "ContactLifetimeTotal",
      "ContactTotalValue",
      "ContactLtv",
      "ContactLTV",
      "Contact.LifetimeValue",
      "Contact.LifetimeTotal",
      "Contact.Ltv",
      "Contact.LTV",
      "Contact.TotalValue",
      "Contact.TotalRevenue",
      "Contact.TotalSales",
      "Contact.TotalSold",
      "LifetimeValue",
      "LifetimeTotal",
      "Ltv",
      "LTV",
    ]) ??
    contactLifetimeValueFromCustomFields(extractCustomFields(raw)) ??
    contactLifetimeValueFromRecord(existingContact(raw), ["Contact"]) ??
    contactLifetimeValueFromRecord(raw, [])
  );
}

function isContactLifetimeValuePath(parts: string[]) {
  const identifier = normalizedIdentifier(parts[parts.length - 1]);
  const fullPath = normalizedIdentifier(pathText(parts));
  const scopedToContact = parts.some((part) => ["contact", "customer", "client"].includes(normalizedIdentifier(part)));

  if (CONTACT_LIFETIME_VALUE_IDENTIFIERS.has(identifier) || CONTACT_LIFETIME_VALUE_IDENTIFIERS.has(fullPath)) return true;
  if (identifier.includes("lifetime") && identifier.includes("value")) return true;
  if (identifier === "ltv" || identifier.endsWith("ltv")) return true;

  if (!scopedToContact) return false;
  if (identifier.includes("lifetime") && (identifier.includes("total") || identifier.includes("sales") || identifier.includes("revenue"))) return true;
  if (identifier.includes("total") && (identifier.includes("revenue") || identifier.includes("sales") || identifier.includes("sold"))) return true;

  return false;
}

function isContactLifetimeValueField(field: CustomFieldValue) {
  const identifiers = [field.name, field.normalizedName, field.rawKey, field.sourcePath].map(normalizedIdentifier);
  return identifiers.some((identifier) => {
    if (CONTACT_LIFETIME_VALUE_IDENTIFIERS.has(identifier)) return true;
    if (identifier.includes("lifetime") && identifier.includes("value")) return true;
    if (identifier === "ltv" || identifier.endsWith("ltv")) return true;
    return false;
  });
}

function contactLifetimeValueFromCustomFields(customFields: CustomFieldValue[]) {
  const field = customFields.find((candidate) => isContactLifetimeValueField(candidate) && candidate.numericValue !== null);
  return field?.numericValue ?? null;
}

function contactLifetimeValueFromRecord(value: unknown, path: string[], depth = 0): number | null {
  if (depth > 5) return null;

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = contactLifetimeValueFromRecord(item, [...path, String(index)], depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const [key, nested] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (!isRecord(nested) && !Array.isArray(nested) && isContactLifetimeValuePath(nextPath)) {
      const parsed = numericValue(nested);
      if (parsed !== null) return parsed;
    }

    const found = contactLifetimeValueFromRecord(nested, nextPath, depth + 1);
    if (found !== null) return found;
  }

  return null;
}

function compactNoteValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (Array.isArray(value)) {
    const notes = value.map(compactNoteValue).filter((note): note is string => Boolean(note));
    return notes.length ? notes.join("\n") : null;
  }

  if (isRecord(value)) {
    const nested = readField(value, ["Text", "Note", "Notes", "Description", "Body", "Comment", "Message", "Value"]);
    return nested === undefined ? null : compactNoteValue(nested);
  }

  return null;
}

function appointmentNotes(raw: RawRecord) {
  const value = readField(raw, APPOINTMENT_NOTE_CANDIDATES);
  return value === undefined ? null : compactNoteValue(value);
}

function firstAppointment(raw: RawRecord) {
  return booleanField(raw, [
    "FirstAppointment",
    "IsFirstAppointment",
    "FirstAppt",
    "First Appt?",
    "IsFirstAppt",
    "FirstVisit",
    "IsFirstVisit",
  ]);
}

function contactVisitCount(raw: RawRecord) {
  return numberField(raw, [
    "ContactVisitCount",
    "ContactAppointmentCount",
    "ContactTotalAppointments",
    "TotalContactAppointments",
    "TotalAppointmentsForContact",
    "ClientVisitCount",
    "ClientAppointmentCount",
    "ClientTotalAppointments",
    "TotalClientAppointments",
    "Contact.VisitCount",
    "Contact.AppointmentCount",
    "Contact.TotalAppointments",
    "Contact.TotalVisits",
  ]);
}

function appointmentUrl(raw: RawRecord) {
  const serviceMinderUrl = serviceMinderAppointmentUrl(raw);
  if (serviceMinderUrl) return serviceMinderUrl;

  const value = readField(raw, APPOINTMENT_URL_CANDIDATES);
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function serviceMinderAppointmentUrl(raw: RawRecord) {
  const rawAppointmentId = appointmentId(raw);
  const rawOrganizationId = organizationId(raw);
  if (!rawAppointmentId || !rawOrganizationId) return null;

  const cleanAppointmentId = rawAppointmentId.trim();
  const cleanOrganizationId = rawOrganizationId.trim();
  if (!/^\d+$/.test(cleanAppointmentId) || !/^\d+$/.test(cleanOrganizationId)) return null;

  return `https://serviceminder.com/o/${cleanOrganizationId}/appointments/details/${cleanAppointmentId}`;
}

function existingContact(raw: RawRecord) {
  const contact = readField(raw, ["Contact", "contact"]);
  return isRecord(contact) ? contact : {};
}

function mergeDefinedFields(base: RawRecord, overlay: RawRecord) {
  const merged: RawRecord = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined || value === null || value === "") continue;
    merged[key] = value;
  }
  return merged;
}

function mergeLocatedContact(raw: RawRecord, contact: RawRecord) {
  return {
    ...raw,
    Contact: mergeDefinedFields(existingContact(raw), contact),
  };
}

function organizationDirectory(input: unknown): OrganizationDirectory {
  const records = firstArray(input, ["Organizations", "organizations", "Matches", "Items", "Results"]).filter(isRecord);
  const byId = new Map<string, RawRecord>();

  for (const record of records) {
    const id = organizationRecordId(record);
    if (id) byId.set(id, record);
  }

  return {
    byId,
    single: records.length === 1 ? records[0] : null,
  };
}

function hydrateAppointmentWithOrganization(raw: RawRecord, directory: OrganizationDirectory): RawRecord {
  const currentName = organizationName(raw);
  const currentId = organizationId(raw);
  const organization = (currentId ? directory.byId.get(currentId) : null) ?? (!currentId && directory.single ? directory.single : null);
  if (!organization) return raw;

  const nextName = currentName ?? organizationRecordName(organization);
  const nextId = currentId ?? organizationRecordId(organization);
  if ((!nextName || nextName === currentName) && (!nextId || nextId === currentId)) return raw;

  return {
    ...raw,
    ...(nextId ? { OrganizationId: nextId } : {}),
    ...(nextName ? { OrganizationName: nextName } : {}),
  };
}

export function hydrateAppointmentsWithOrganizations(
  appointmentRecords: RawRecord[],
  organizationsResponse: unknown,
): RawRecord[] {
  const directory = organizationDirectory(organizationsResponse);
  if (!directory.single && !directory.byId.size) return appointmentRecords;
  return appointmentRecords.map((appointment) => hydrateAppointmentWithOrganization(appointment, directory));
}

function positiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results: R[] = new Array(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, values.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index], index);
      }
    }),
  );

  return results;
}

export function normalizeAppointment(input: unknown): ConservaAppointmentRow {
  const raw = isRecord(input) ? input : {};
  const extractedCustomFields = extractCustomFields(raw);
  const sesScore = sesScoreField(raw) ?? sesScoreFromCustomFields(extractedCustomFields);
  const customFields = sesScore ? [sesScore] : [];
  const scoreValues = sesScore?.scoreLike ? [sesScore] : [];
  const completedDate = actualFinishDate(raw);
  const scheduledDate = appointmentDate(raw);
  const isCompleted = completedState(raw);
  const flags: string[] = [];

  if (!sesScore) flags.push("Missing SES score");
  if (!completedDate) flags.push("Missing completed date");
  if (!contactName(raw)) flags.push("Missing contact");

  return {
    id: appointmentId(raw),
    appointmentUrl: appointmentUrl(raw),
    appointmentDate: scheduledDate,
    completedDate,
    isCompleted,
    status: appointmentStatus(raw),
    customerName: contactName(raw),
    contactId: contactId(raw),
    serviceName: stringField(raw, ["ServiceName", "Service.Name", "Service"]),
    serviceId: stringField(raw, ["ServiceId", "Service.Id"]),
    serviceAgentName: stringField(raw, [
      "ServiceAgentName",
      "TechnicianName",
      "AgentName",
      "ServiceAgent.Name",
      "Technician.Name",
    ]),
    serviceAgentId: stringField(raw, [
      "ServiceAgentId",
      "TechnicianId",
      "AgentId",
      "ServiceAgent.Id",
      "Technician.Id",
    ]),
    organizationName: organizationName(raw),
    organizationId: organizationId(raw),
    locationName: stringField(raw, ["LocationName", "Location.Name", "LocationId"]),
    appointmentTotal: appointmentTotal(raw),
    contactLifetimeValue: contactLifetimeValue(raw),
    appointmentNotes: appointmentNotes(raw),
    firstAppointment: firstAppointment(raw),
    contactVisitCount: contactVisitCount(raw),
    weekNumber: numberField(raw, ["WeekNumber", "Week Number"]) ?? isoWeekNumber(completedDate ?? scheduledDate),
    sesScore,
    hasSesScore: Boolean(sesScore),
    customFields,
    customFieldNames: sesScore ? [SES_SCORE_FIELD_NAME] : [],
    scoreValues,
    flags,
    raw,
  };
}

export async function hydrateAppointmentsWithContacts(
  appointmentRecords: RawRecord[],
  contactLocator: ContactLocator,
): Promise<RawRecord[]> {
  const contactCache = new Map<string, Promise<RawRecord | null>>();
  const concurrency = positiveIntegerEnv("SERVICEMINDER_CONTACT_HYDRATION_CONCURRENCY", 4);

  return mapWithConcurrency(appointmentRecords, concurrency, async (appointment) => {
    const row = normalizeAppointment(appointment);
    if (row.hasSesScore && row.contactLifetimeValue !== null) return appointment;

    const contactId = stringField(appointment, CONTACT_ID_CANDIDATES);
    if (!contactId) return appointment;

    let contactPromise = contactCache.get(contactId);
    if (!contactPromise) {
      contactPromise = contactLocator.locateContact(contactId).catch(() => null);
      contactCache.set(contactId, contactPromise);
    }

    const contact = await contactPromise;
    return contact ? mergeLocatedContact(appointment, contact) : appointment;
  });
}

function appointmentTime(raw: RawRecord) {
  const value = appointmentDate(raw) ?? actualFinishDate(raw);
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function latestAppointmentDateKey(appointments: RawRecord[]) {
  let latest: string | null = null;

  for (const appointment of appointments) {
    const value = appointmentDate(appointment) ?? actualFinishDate(appointment);
    if (!value) continue;
    if (!latest || value > latest) latest = value;
  }

  return dateKey(latest);
}

async function appointmentHistoryForContact(
  appointmentHistoryLocator: AppointmentHistoryLocator,
  contactIdValue: string,
  appointments: RawRecord[],
) {
  const throughDate = latestAppointmentDateKey(appointments);
  if (!throughDate) return null;

  try {
    const response = await appointmentHistoryLocator.queryAppointments({
      fromDate: process.env.SERVICEMINDER_FIRST_APPOINTMENT_LOOKBACK_FROM ?? "1900-01-01",
      throughDate,
      contactId: contactIdValue,
      includeContact: false,
      includeCompleted: true,
      take: positiveIntegerEnv("SERVICEMINDER_FIRST_APPOINTMENT_PAGE_SIZE", 50),
      maxRecords: positiveIntegerEnv("SERVICEMINDER_FIRST_APPOINTMENT_MAX_RECORDS", 200),
    });
    return response.items;
  } catch {
    return null;
  }
}

function appointmentHistoryKey(raw: RawRecord) {
  const id = appointmentId(raw);
  if (id) return `id:${id}`;
  const time = appointmentTime(raw);
  const serviceIdValue = stringField(raw, ["ServiceId", "Service.Id"]) ?? "";
  const serviceNameValue = stringField(raw, ["ServiceName", "Service.Name", "Service"]) ?? "";
  return time === null ? null : `time:${time}|service:${serviceIdValue}|name:${serviceNameValue}`;
}

function uniqueContactAppointmentHistory(history: RawRecord[], currentContactId: string) {
  const seen = new Set<string>();
  const unique: RawRecord[] = [];

  for (const candidate of history) {
    const candidateContactId = contactId(candidate);
    if (candidateContactId && candidateContactId !== currentContactId) continue;

    const key = appointmentHistoryKey(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}

export async function hydrateAppointmentsWithFirstAppointmentStatus(
  appointmentRecords: RawRecord[],
  appointmentHistoryLocator: AppointmentHistoryLocator,
): Promise<RawRecord[]> {
  const appointmentsByContact = new Map<string, RawRecord[]>();

  for (const appointment of appointmentRecords) {
    const currentContactId = contactId(appointment);
    if (!currentContactId || appointmentTime(appointment) === null) continue;
    const appointments = appointmentsByContact.get(currentContactId) ?? [];
    appointments.push(appointment);
    appointmentsByContact.set(currentContactId, appointments);
  }

  const contactIds = Array.from(appointmentsByContact.keys());
  if (!contactIds.length) return appointmentRecords;

  const historyByContact = new Map<string, RawRecord[] | null>();
  const concurrency = positiveIntegerEnv("SERVICEMINDER_FIRST_APPOINTMENT_CONCURRENCY", 3);

  await mapWithConcurrency(contactIds, concurrency, async (currentContactId) => {
    const currentAppointments = appointmentsByContact.get(currentContactId) ?? [];
    const history = await appointmentHistoryForContact(appointmentHistoryLocator, currentContactId, currentAppointments);
    historyByContact.set(currentContactId, history ? uniqueContactAppointmentHistory([...history, ...currentAppointments], currentContactId) : null);
  });

  return appointmentRecords.map((appointment) => {
    const currentContactId = contactId(appointment);
    const currentTime = appointmentTime(appointment);
    if (!currentContactId || currentTime === null) return appointment;

    const history = historyByContact.get(currentContactId);
    if (!history) return appointment;

    const currentAppointmentId = appointmentId(appointment);
    const hasPriorAppointment = history.some((candidate) => {
      const candidateContactId = contactId(candidate);
      if (candidateContactId && candidateContactId !== currentContactId) return false;
      const candidateAppointmentId = appointmentId(candidate);
      if (currentAppointmentId && candidateAppointmentId === currentAppointmentId) return false;
      const candidateTime = appointmentTime(candidate);
      return candidateTime !== null && candidateTime < currentTime;
    });

    return {
      ...appointment,
      FirstAppointment: !hasPriorAppointment,
      ContactVisitCount: history.length,
    };
  });
}

function rowMatchesFilters(row: ConservaAppointmentRow, filters: ConservaReportFilters) {
  if (!row.isCompleted) return false;
  const rowDate = dateKey(row.completedDate ?? row.appointmentDate);
  if (filters.from && rowDate && rowDate < filters.from) return false;
  if (filters.through && rowDate && rowDate > filters.through) return false;
  if (filters.serviceAgentId && row.serviceAgentId !== filters.serviceAgentId) return false;
  if (filters.serviceAgentName && row.serviceAgentName !== filters.serviceAgentName) return false;
  const serviceTypes = filters.serviceTypes?.filter(Boolean) ?? [];
  if (serviceTypes.length && (!row.serviceName || !serviceTypes.includes(row.serviceName))) return false;
  if (!serviceTypes.length && filters.serviceType && row.serviceName !== filters.serviceType) return false;
  if (filters.organization) {
    const matchesOrganization = row.organizationName === filters.organization || row.locationName === filters.organization;
    if (!matchesOrganization) return false;
  }
  if ((filters.missingSesScore || filters.missingSelectedField) && row.hasSesScore) return false;

  const scoreValue = row.sesScore?.numericValue ?? null;
  if (filters.minScore !== null && filters.minScore !== undefined && (scoreValue === null || scoreValue < filters.minScore)) {
    return false;
  }
  if (filters.maxScore !== null && filters.maxScore !== undefined && (scoreValue === null || scoreValue > filters.maxScore)) {
    return false;
  }

  if (filters.search) {
    const haystack = [
      row.id,
      row.customerName,
      row.serviceName,
      row.serviceAgentName,
      row.organizationName,
      row.status,
      row.appointmentNotes,
      row.sesScore?.displayValue,
      row.contactVisitCount === null ? null : `${row.contactVisitCount} visits`,
      row.hasSesScore ? "has ses score" : "missing ses score",
      row.firstAppointment === true ? "first appointment" : row.firstAppointment === false ? "not first appointment" : null,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(filters.search.toLowerCase())) return false;
  }

  return true;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function summarizeRows(rows: ConservaAppointmentRow[]): ConservaReportSummary {
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

function scoreTrends(rows: ConservaAppointmentRow[]): ScoreTrendPoint[] {
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

export function buildConservaReport(
  appointmentRecords: RawRecord[],
  filters: ConservaReportFilters,
  source: ConservaReportResult["source"],
  rawPayloads: RawRecord[] = [],
  warning: string | null = null,
): ConservaReportResult {
  const rows = appointmentRecords
    .map(normalizeAppointment)
    .filter((row) => rowMatchesFilters(row, filters))
    .sort(compareRowsByAppointmentDateDesc);
  const allFields = rows.flatMap((row) => row.customFields);

  return {
    source,
    warning,
    rows,
    summary: summarizeRows(rows),
    fieldSummaries: summarizeFieldValues(rows.length, allFields),
    scoreTrends: scoreTrends(rows),
    rawPayloads,
  };
}

function cacheRecordsFromAppointments(appointmentRecords: RawRecord[]): AppointmentCacheRecord[] {
  return appointmentRecords.map((appointment) => {
    const row = normalizeAppointment(appointment);
    return {
      recordKey: appointmentCacheRecordKey(row.id, appointment),
      appointmentId: row.id,
      reportDate: dateKey(row.completedDate ?? row.appointmentDate),
      payload: appointment,
    };
  });
}

async function recordReportRun(userId: string, result: ConservaReportResult, filters: ConservaReportFilters) {
  if (!isDatabaseConfigured()) return;
  try {
    await getPrisma().reportRun.create({
      data: {
        userId,
        reportType: "conserva-ses-score",
        filters: filters as Prisma.InputJsonObject,
        source: result.source,
        rowCount: result.rows.length,
        rawPayload: redactSecrets(result.rawPayloads) as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Report run persistence should not block the dashboard.
  }
}

export async function getConservaReport(
  userId: string,
  filters: ConservaReportFilters,
  options: ConservaReportOptions = {},
): Promise<ConservaReportResult> {
  try {
    const [settings, apiKey] = await Promise.all([getSettings(userId), getDecryptedApiKey(userId)]);
    if (!apiKey) {
      const mockRecords = firstArray(mockAppointmentPayload, ["Appointments"]).filter(isRecord);
      return buildConservaReport(
        mockRecords,
        filters,
        "mock",
        [mockAppointmentPayload],
        "No ServiceMinder API key is configured. Showing representative mock data.",
      );
    }

    const client = new ServiceMinderClient({
      baseUrl: settings.apiBaseUrl,
      apiKey,
    });
    const includeContact = settings.includeContactDefault;
    const cacheContext = serviceMinderAppointmentCacheContext({
      userId,
      apiBaseUrl: settings.apiBaseUrl,
      apiKey,
    });

    if (!options.refreshCache) {
      const cachedAppointments = await readCachedCompletedAppointments(cacheContext, filters, { includeContact });
      if (cachedAppointments) {
        const contactHydratedItems = await hydrateAppointmentsWithContacts(cachedAppointments, client);
        const result = buildConservaReport(contactHydratedItems, filters, "cache");
        await writeCachedCompletedAppointments(
          cacheContext,
          filters,
          { includeContact },
          cacheRecordsFromAppointments(contactHydratedItems),
          null,
        );
        await recordReportRun(userId, result, filters);
        return result;
      }
    }

    const [payloads, organizationsResponse] = await Promise.all([
      client.queryAppointments({
        fromDate: filters.from,
        throughDate: filters.through,
        includeContact,
        includeCompleted: true,
      }),
      client.organizations().catch(() => null),
    ]);
    const organizationHydratedItems = hydrateAppointmentsWithOrganizations(payloads.items, organizationsResponse);
    const contactHydratedItems = await hydrateAppointmentsWithContacts(organizationHydratedItems, client);
    const firstAppointmentHydratedItems = await hydrateAppointmentsWithFirstAppointmentStatus(contactHydratedItems, client);
    const result = buildConservaReport(firstAppointmentHydratedItems, filters, "live", payloads.rawResponses, payloads.warning);
    await writeCachedCompletedAppointments(
      cacheContext,
      filters,
      { includeContact },
      cacheRecordsFromAppointments(firstAppointmentHydratedItems),
      payloads.warning,
    );
    await recordReportRun(userId, result, filters);
    return result;
  } catch (error) {
    const mockRecords = firstArray(mockAppointmentPayload, ["Appointments"]).filter(isRecord);
    const message = error instanceof Error ? error.message : "Unknown ServiceMinder error.";
    return buildConservaReport(
      mockRecords,
      filters,
      "mock",
      [mockAppointmentPayload],
      `${message} Showing representative mock data.`,
    );
  }
}

export function lookupOptions(rows: ConservaAppointmentRow[]) {
  const agents = new Map<string, string>();
  const services = new Set<string>();
  const organizations = new Set<string>();
  const customFields = new Set<string>();

  for (const row of rows) {
    if (row.serviceAgentId || row.serviceAgentName) {
      agents.set(row.serviceAgentId ?? row.serviceAgentName ?? "", row.serviceAgentName ?? row.serviceAgentId ?? "");
    }
    if (row.serviceName) services.add(row.serviceName);
    if (row.organizationName) organizations.add(row.organizationName);
    if (row.hasSesScore) customFields.add(SES_SCORE_FIELD_NAME);
  }

  return {
    serviceAgents: Array.from(agents.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    services: Array.from(services).sort().map((name) => ({ name })),
    organizations: Array.from(organizations).sort().map((name) => ({ name })),
    customFields: Array.from(customFields).sort().map((name) => ({ name })),
  };
}

function uniqueNamedOptions(names: Array<string | null>) {
  return Array.from(new Set(names.filter((name): name is string => Boolean(name))))
    .sort()
    .map((name) => ({ name }));
}

export function lookupOptionsFromServiceMinderResponses({
  serviceAgentsResponse,
  servicesResponse,
  organizationsResponse,
}: LookupOptionResponses) {
  const serviceAgentRecords = firstArray(serviceAgentsResponse, [
    "ServiceAgents",
    "serviceAgents",
    "Agents",
    "agents",
    "Matches",
    "Items",
    "Results",
  ]).filter(isRecord);
  const serviceRecords = firstArray(servicesResponse, [
    "Services",
    "services",
    "ServiceTypes",
    "serviceTypes",
    "Items",
    "Results",
  ]).filter(isRecord);
  const organizationRecords = firstArray(organizationsResponse, [
    "Organizations",
    "organizations",
    "Matches",
    "Items",
    "Results",
  ]).filter(isRecord);

  const agents = new Map<string, string>();
  for (const record of serviceAgentRecords) {
    const name = serviceAgentRecordName(record);
    if (!name) continue;
    agents.set(serviceAgentRecordId(record) ?? name, name);
  }

  return {
    serviceAgents: Array.from(agents.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    services: uniqueNamedOptions(serviceRecords.map(serviceRecordName)),
    organizations: uniqueNamedOptions(organizationRecords.map(organizationRecordName)),
  };
}
