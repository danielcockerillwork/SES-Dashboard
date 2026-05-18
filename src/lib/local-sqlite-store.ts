import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { localDataDir } from "@/lib/local-store";
import { isRecord, stringField, type RawRecord } from "@/lib/serviceminder/field-access";

const STORE_SCHEMA_VERSION = 1;

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
  "Contact.OrganizationName",
  "Contact.Organization.Name",
  "Contact.Organization.PublicName",
];

type SqliteRow = Record<string, unknown>;

export type LocalSqliteAppointmentCacheContext = {
  userId: string;
  apiBaseUrl: string;
  apiKeyHash: string;
};

export type LocalSqliteAppointmentCacheRecord = {
  recordKey: string;
  appointmentId: string | null;
  reportDate: string | null;
  payload: RawRecord;
};

export type LocalSqliteAppointmentCacheWindow = {
  fromDate: string;
  throughDate: string;
  fetchedAt: string;
};

export type LocalSqliteAppointmentCacheWrite = {
  context: LocalSqliteAppointmentCacheContext;
  includeContact: boolean;
  fromDate: string;
  throughDate: string;
  records: LocalSqliteAppointmentCacheRecord[];
  warning: string | null;
  orgId?: string | null;
  orgName?: string | null;
};

let db: DatabaseSync | null = null;

function nowIso() {
  return new Date().toISOString();
}

export function localSqlitePath() {
  return process.env.SES_DASHBOARD_SQLITE_PATH ?? path.join(localDataDir(), "dashboard.sqlite");
}

function includeContactValue(value: boolean) {
  return value ? 1 : 0;
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function orgIdFromPayload(payload: RawRecord) {
  return nullableText(stringField(payload, ORGANIZATION_ID_CANDIDATES));
}

function orgNameFromPayload(payload: RawRecord) {
  return nullableText(stringField(payload, ORGANIZATION_NAME_CANDIDATES));
}

function windowKey(input: {
  context: LocalSqliteAppointmentCacheContext;
  includeContact: boolean;
  orgId: string | null;
  fromDate: string;
  throughDate: string;
}) {
  return [
    input.context.userId,
    input.context.apiBaseUrl,
    input.context.apiKeyHash,
    includeContactValue(input.includeContact),
    input.orgId ?? "*",
    input.fromDate,
    input.throughDate,
    STORE_SCHEMA_VERSION,
  ].join("\0");
}

function openDatabase() {
  if (db) return db;
  const dbPath = localSqlitePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS cache_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizations (
      user_id TEXT NOT NULL,
      api_base_url TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      org_id TEXT NOT NULL,
      name TEXT,
      display_name TEXT,
      source TEXT NOT NULL,
      raw_json TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_refreshed_at TEXT NOT NULL,
      PRIMARY KEY (user_id, api_base_url, api_key_hash, org_id)
    );

    CREATE TABLE IF NOT EXISTS appointment_cache_entries (
      user_id TEXT NOT NULL,
      api_base_url TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      include_contact INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      record_key TEXT NOT NULL,
      appointment_id TEXT,
      org_id TEXT,
      org_name TEXT,
      report_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, api_base_url, api_key_hash, include_contact, schema_version, record_key)
    );

    CREATE TABLE IF NOT EXISTS appointment_cache_windows (
      window_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      api_base_url TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      include_contact INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      org_id TEXT,
      org_name TEXT,
      from_date TEXT NOT NULL,
      through_date TEXT NOT NULL,
      warning TEXT,
      fetched_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_appointment_cache_entries_range
      ON appointment_cache_entries (user_id, api_base_url, api_key_hash, include_contact, schema_version, report_date);

    CREATE INDEX IF NOT EXISTS idx_appointment_cache_entries_org_range
      ON appointment_cache_entries (user_id, api_base_url, api_key_hash, include_contact, schema_version, org_id, report_date);

    CREATE INDEX IF NOT EXISTS idx_appointment_cache_entries_appointment
      ON appointment_cache_entries (user_id, api_base_url, api_key_hash, appointment_id);

    CREATE INDEX IF NOT EXISTS idx_appointment_cache_windows_range
      ON appointment_cache_windows (user_id, api_base_url, api_key_hash, include_contact, schema_version, from_date, through_date);
  `);
  database.prepare("INSERT OR REPLACE INTO cache_metadata (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(STORE_SCHEMA_VERSION),
  );
}

export function closeLocalSqliteStoreForTests() {
  db?.close();
  db = null;
}

export function upsertLocalSqliteOrganization(input: {
  context: LocalSqliteAppointmentCacheContext;
  orgId: string;
  name: string | null;
  displayName?: string | null;
  source: string;
  raw?: unknown;
}) {
  const database = openDatabase();
  const timestamp = nowIso();
  database
    .prepare(`
      INSERT INTO organizations (
        user_id, api_base_url, api_key_hash, org_id, name, display_name, source, raw_json,
        first_seen_at, last_seen_at, last_refreshed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, api_base_url, api_key_hash, org_id) DO UPDATE SET
        name = COALESCE(excluded.name, organizations.name),
        display_name = COALESCE(excluded.display_name, organizations.display_name),
        source = excluded.source,
        raw_json = COALESCE(excluded.raw_json, organizations.raw_json),
        last_seen_at = excluded.last_seen_at,
        last_refreshed_at = excluded.last_refreshed_at
    `)
    .run(
      input.context.userId,
      input.context.apiBaseUrl,
      input.context.apiKeyHash,
      input.orgId,
      input.name,
      input.displayName ?? input.name,
      input.source,
      input.raw === undefined ? null : JSON.stringify(input.raw),
      timestamp,
      timestamp,
      timestamp,
    );
}

export function listLocalSqliteOrganizations(context: LocalSqliteAppointmentCacheContext) {
  return openDatabase()
    .prepare(
      `
        SELECT org_id AS orgId, name, display_name AS displayName, source, last_seen_at AS lastSeenAt
        FROM organizations
        WHERE user_id = ? AND api_base_url = ? AND api_key_hash = ?
        ORDER BY COALESCE(display_name, name, org_id)
      `,
    )
    .all(context.userId, context.apiBaseUrl, context.apiKeyHash) as Array<{
    orgId: string;
    name: string | null;
    displayName: string | null;
    source: string;
    lastSeenAt: string;
  }>;
}

export function readLocalSqliteCacheWindows(
  context: LocalSqliteAppointmentCacheContext,
  includeContact: boolean,
): LocalSqliteAppointmentCacheWindow[] {
  return openDatabase()
    .prepare(
      `
        SELECT from_date AS fromDate, through_date AS throughDate, fetched_at AS fetchedAt
        FROM appointment_cache_windows
        WHERE user_id = ?
          AND api_base_url = ?
          AND api_key_hash = ?
          AND include_contact = ?
          AND schema_version = ?
        ORDER BY from_date ASC
      `,
    )
    .all(
      context.userId,
      context.apiBaseUrl,
      context.apiKeyHash,
      includeContactValue(includeContact),
      STORE_SCHEMA_VERSION,
    ) as LocalSqliteAppointmentCacheWindow[];
}

export function readLocalSqliteAppointmentPayloads(input: {
  context: LocalSqliteAppointmentCacheContext;
  includeContact: boolean;
  fromDate: string;
  throughDate: string;
}) {
  const rows = openDatabase()
    .prepare(
      `
        SELECT payload_json AS payloadJson
        FROM appointment_cache_entries
        WHERE user_id = ?
          AND api_base_url = ?
          AND api_key_hash = ?
          AND include_contact = ?
          AND schema_version = ?
          AND report_date >= ?
          AND report_date <= ?
        ORDER BY report_date DESC, appointment_id DESC
      `,
    )
    .all(
      input.context.userId,
      input.context.apiBaseUrl,
      input.context.apiKeyHash,
      includeContactValue(input.includeContact),
      STORE_SCHEMA_VERSION,
      input.fromDate,
      input.throughDate,
    ) as Array<{ payloadJson: string }>;

  return rows
    .map((row) => {
      try {
        return JSON.parse(row.payloadJson);
      } catch {
        return null;
      }
    })
    .filter(isRecord);
}

export function writeLocalSqliteAppointmentCache(input: LocalSqliteAppointmentCacheWrite) {
  const database = openDatabase();
  const fetchedAt = nowIso();
  const includeContact = includeContactValue(input.includeContact);

  database.exec("BEGIN IMMEDIATE TRANSACTION;");
  try {
    const upsertOrganization = database.prepare(`
      INSERT INTO organizations (
        user_id, api_base_url, api_key_hash, org_id, name, display_name, source, raw_json,
        first_seen_at, last_seen_at, last_refreshed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, api_base_url, api_key_hash, org_id) DO UPDATE SET
        name = COALESCE(excluded.name, organizations.name),
        display_name = COALESCE(excluded.display_name, organizations.display_name),
        source = excluded.source,
        raw_json = COALESCE(excluded.raw_json, organizations.raw_json),
        last_seen_at = excluded.last_seen_at,
        last_refreshed_at = excluded.last_refreshed_at
    `);
    const upsertAppointment = database.prepare(`
      INSERT INTO appointment_cache_entries (
        user_id, api_base_url, api_key_hash, include_contact, schema_version, record_key,
        appointment_id, org_id, org_name, report_date, payload_json, fetched_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, api_base_url, api_key_hash, include_contact, schema_version, record_key) DO UPDATE SET
        appointment_id = excluded.appointment_id,
        org_id = excluded.org_id,
        org_name = excluded.org_name,
        report_date = excluded.report_date,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `);

    for (const record of input.records) {
      const orgId = orgIdFromPayload(record.payload);
      const orgName = orgNameFromPayload(record.payload);
      if (orgId) {
        upsertOrganization.run(
          input.context.userId,
          input.context.apiBaseUrl,
          input.context.apiKeyHash,
          orgId,
          orgName,
          orgName,
          "appointments",
          JSON.stringify({ orgId, orgName }),
          fetchedAt,
          fetchedAt,
          fetchedAt,
        );
      }

      upsertAppointment.run(
        input.context.userId,
        input.context.apiBaseUrl,
        input.context.apiKeyHash,
        includeContact,
        STORE_SCHEMA_VERSION,
        record.recordKey,
        record.appointmentId,
        orgId,
        orgName,
        record.reportDate ?? input.fromDate,
        JSON.stringify(record.payload),
        fetchedAt,
        fetchedAt,
      );
    }

    const scopedOrgId = input.orgId ?? null;
    const scopedOrgName = input.orgName ?? null;
    database
      .prepare(
        `
          INSERT INTO appointment_cache_windows (
            window_key, user_id, api_base_url, api_key_hash, include_contact, schema_version,
            org_id, org_name, from_date, through_date, warning, fetched_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(window_key) DO UPDATE SET
            warning = excluded.warning,
            fetched_at = excluded.fetched_at,
            org_name = COALESCE(excluded.org_name, appointment_cache_windows.org_name)
        `,
      )
      .run(
        windowKey({
          context: input.context,
          includeContact: input.includeContact,
          orgId: scopedOrgId,
          fromDate: input.fromDate,
          throughDate: input.throughDate,
        }),
        input.context.userId,
        input.context.apiBaseUrl,
        input.context.apiKeyHash,
        includeContact,
        STORE_SCHEMA_VERSION,
        scopedOrgId,
        scopedOrgName,
        input.fromDate,
        input.throughDate,
        input.warning,
        fetchedAt,
      );

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function localSqliteStats(context: LocalSqliteAppointmentCacheContext) {
  const database = openDatabase();
  const appointmentRow = database
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM appointment_cache_entries
        WHERE user_id = ? AND api_base_url = ? AND api_key_hash = ?
      `,
    )
    .get(context.userId, context.apiBaseUrl, context.apiKeyHash) as SqliteRow | undefined;
  const organizationRow = database
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM organizations
        WHERE user_id = ? AND api_base_url = ? AND api_key_hash = ?
      `,
    )
    .get(context.userId, context.apiBaseUrl, context.apiKeyHash) as SqliteRow | undefined;
  return {
    appointments: Number(appointmentRow?.count ?? 0),
    organizations: Number(organizationRow?.count ?? 0),
  };
}
