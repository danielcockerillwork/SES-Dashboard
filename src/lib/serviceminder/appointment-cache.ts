import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import { isDesktopMode } from "@/lib/runtime";
import { isRecord, type RawRecord } from "@/lib/serviceminder/field-access";

const APPOINTMENT_CACHE_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_UPSERT_BATCH_SIZE = 100;

export type AppointmentCacheContext = {
  userId: string;
  apiBaseUrl: string;
  apiKeyHash: string;
};

export type AppointmentCacheRecord = {
  recordKey: string;
  appointmentId: string | null;
  reportDate: string | null;
  payload: RawRecord;
};

export type AppointmentCacheWindow = {
  fromDate: string;
  throughDate: string;
  fetchedAt: Date | string;
};

type AppointmentCacheRange = {
  from: string;
  through: string;
};

type AppointmentCacheOptions = {
  includeContact: boolean;
};

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedBaseUrl(value: string) {
  return value.trim().replace(/\/$/, "");
}

function cacheDisabled() {
  return /^(1|true|yes)$/i.test(process.env.SERVICEMINDER_APPOINTMENT_CACHE_DISABLED ?? "");
}

function cacheTtlMs() {
  const parsed = Number(process.env.SERVICEMINDER_APPOINTMENT_CACHE_TTL_SECONDS);
  if (Number.isFinite(parsed) && parsed > 0) return parsed * 1000;
  return DEFAULT_CACHE_TTL_SECONDS * 1000;
}

function cacheAvailable() {
  return (isDesktopMode() || isDatabaseConfigured()) && !cacheDisabled();
}

async function localSqliteStore() {
  return import("@/lib/local-sqlite-store");
}

function parseDateKey(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function addOneDay(dateKey: string) {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function isFresh(fetchedAt: Date | string, ttlMs: number, now: Date) {
  const fetchedTime = new Date(fetchedAt).getTime();
  return !Number.isNaN(fetchedTime) && now.getTime() - fetchedTime <= ttlMs;
}

export function serviceMinderAppointmentCacheContext(input: {
  userId: string;
  apiBaseUrl: string;
  apiKey: string;
}): AppointmentCacheContext {
  const apiBaseUrl = normalizedBaseUrl(input.apiBaseUrl);
  return {
    userId: input.userId,
    apiBaseUrl,
    apiKeyHash: hashValue(`${apiBaseUrl}\0${input.apiKey}`),
  };
}

export function appointmentCacheRecordKey(appointmentId: string | null, payload: RawRecord) {
  const cleanId = appointmentId?.trim();
  if (cleanId) return `appointment:${cleanId}`;
  return `payload:${hashValue(stableJson(payload))}`;
}

export function cacheWindowsCoverRange(
  windows: AppointmentCacheWindow[],
  fromDate: string,
  throughDate: string,
  ttlMs = cacheTtlMs(),
  now = new Date(),
) {
  const requestedFrom = parseDateKey(fromDate);
  const requestedThrough = parseDateKey(throughDate);
  if (!requestedFrom || !requestedThrough || requestedFrom > requestedThrough) return false;

  const freshWindows = windows
    .filter((window) => isFresh(window.fetchedAt, ttlMs, now))
    .map((window) => ({
      fromDate: parseDateKey(window.fromDate),
      throughDate: parseDateKey(window.throughDate),
    }))
    .filter(
      (window): window is { fromDate: string; throughDate: string } =>
        Boolean(window.fromDate && window.throughDate && window.fromDate <= window.throughDate),
    )
    .sort((left, right) => left.fromDate.localeCompare(right.fromDate));

  let coveredThrough: string | null = null;

  for (const window of freshWindows) {
    if (!coveredThrough) {
      if (window.fromDate > requestedFrom || window.throughDate < requestedFrom) continue;
      coveredThrough = window.throughDate;
    } else {
      const nextNeeded = addOneDay(coveredThrough);
      if (!nextNeeded || window.fromDate > nextNeeded) break;
      if (window.throughDate > coveredThrough) coveredThrough = window.throughDate;
    }

    if (coveredThrough >= requestedThrough) return true;
  }

  return false;
}

export async function readCachedCompletedAppointments(
  context: AppointmentCacheContext,
  range: AppointmentCacheRange,
  options: AppointmentCacheOptions,
): Promise<RawRecord[] | null> {
  if (!cacheAvailable()) return null;

  const fromDate = parseDateKey(range.from);
  const throughDate = parseDateKey(range.through);
  if (!fromDate || !throughDate) return null;

  try {
    if (isDesktopMode()) {
      const { readLocalSqliteAppointmentPayloads, readLocalSqliteCacheWindows } = await localSqliteStore();
      const windows = readLocalSqliteCacheWindows(context, options.includeContact);
      if (!cacheWindowsCoverRange(windows, fromDate, throughDate)) return null;
      return readLocalSqliteAppointmentPayloads({
        context,
        includeContact: options.includeContact,
        fromDate,
        throughDate,
      });
    }

    const prisma = getPrisma();
    const windows = await prisma.serviceMinderAppointmentCacheWindow.findMany({
      where: {
        userId: context.userId,
        apiBaseUrl: context.apiBaseUrl,
        apiKeyHash: context.apiKeyHash,
        includeContact: options.includeContact,
        schemaVersion: APPOINTMENT_CACHE_SCHEMA_VERSION,
        fromDate: { lte: throughDate },
        throughDate: { gte: fromDate },
      },
      select: {
        fromDate: true,
        throughDate: true,
        fetchedAt: true,
      },
    });

    if (!cacheWindowsCoverRange(windows, fromDate, throughDate)) return null;

    const entries = await prisma.serviceMinderAppointmentCacheEntry.findMany({
      where: {
        userId: context.userId,
        apiBaseUrl: context.apiBaseUrl,
        apiKeyHash: context.apiKeyHash,
        includeContact: options.includeContact,
        schemaVersion: APPOINTMENT_CACHE_SCHEMA_VERSION,
        reportDate: {
          gte: fromDate,
          lte: throughDate,
        },
      },
      orderBy: [{ reportDate: "desc" }, { appointmentId: "desc" }],
      select: {
        payload: true,
      },
    });

    const payloads: RawRecord[] = [];
    for (const entry of entries) {
      if (isRecord(entry.payload)) payloads.push(entry.payload);
    }
    return payloads;
  } catch {
    return null;
  }
}

export async function writeCachedCompletedAppointments(
  context: AppointmentCacheContext,
  range: AppointmentCacheRange,
  options: AppointmentCacheOptions,
  records: AppointmentCacheRecord[],
  warning: string | null,
) {
  if (!cacheAvailable()) return;

  const fromDate = parseDateKey(range.from);
  const throughDate = parseDateKey(range.through);
  if (!fromDate || !throughDate) return;

  const cacheableRecords = records.filter((record) => record.reportDate && record.reportDate >= fromDate && record.reportDate <= throughDate);

  try {
    if (isDesktopMode()) {
      const { writeLocalSqliteAppointmentCache } = await localSqliteStore();
      writeLocalSqliteAppointmentCache({
        context,
        includeContact: options.includeContact,
        fromDate,
        throughDate,
        records: cacheableRecords,
        warning,
      });
      return;
    }

    const prisma = getPrisma();
    for (let index = 0; index < cacheableRecords.length; index += CACHE_UPSERT_BATCH_SIZE) {
      const chunk = cacheableRecords.slice(index, index + CACHE_UPSERT_BATCH_SIZE);
      await prisma.$transaction(
        chunk.map((record) =>
          prisma.serviceMinderAppointmentCacheEntry.upsert({
            where: {
              userId_apiBaseUrl_apiKeyHash_recordKey_includeContact_schemaVersion: {
                userId: context.userId,
                apiBaseUrl: context.apiBaseUrl,
                apiKeyHash: context.apiKeyHash,
                recordKey: record.recordKey,
                includeContact: options.includeContact,
                schemaVersion: APPOINTMENT_CACHE_SCHEMA_VERSION,
              },
            },
            create: {
              userId: context.userId,
              apiBaseUrl: context.apiBaseUrl,
              apiKeyHash: context.apiKeyHash,
              recordKey: record.recordKey,
              appointmentId: record.appointmentId,
              reportDate: record.reportDate ?? fromDate,
              includeContact: options.includeContact,
              payload: record.payload as Prisma.InputJsonValue,
              schemaVersion: APPOINTMENT_CACHE_SCHEMA_VERSION,
            },
            update: {
              appointmentId: record.appointmentId,
              reportDate: record.reportDate ?? fromDate,
              payload: record.payload as Prisma.InputJsonValue,
              fetchedAt: new Date(),
            },
          }),
        ),
      );
    }

    await prisma.serviceMinderAppointmentCacheWindow.upsert({
      where: {
        userId_apiBaseUrl_apiKeyHash_fromDate_throughDate_includeContact_schemaVersion: {
          userId: context.userId,
          apiBaseUrl: context.apiBaseUrl,
          apiKeyHash: context.apiKeyHash,
          fromDate,
          throughDate,
          includeContact: options.includeContact,
          schemaVersion: APPOINTMENT_CACHE_SCHEMA_VERSION,
        },
      },
      create: {
        userId: context.userId,
        apiBaseUrl: context.apiBaseUrl,
        apiKeyHash: context.apiKeyHash,
        fromDate,
        throughDate,
        includeContact: options.includeContact,
        schemaVersion: APPOINTMENT_CACHE_SCHEMA_VERSION,
        warning,
      },
      update: {
        warning,
        fetchedAt: new Date(),
      },
    });
  } catch {
    // Cache persistence should not block report generation.
  }
}
