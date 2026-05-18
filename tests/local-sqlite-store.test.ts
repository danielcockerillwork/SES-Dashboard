import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeLocalSqliteStoreForTests,
  listLocalSqliteOrganizations,
  localSqlitePath,
  localSqliteStats,
  readLocalSqliteAppointmentPayloads,
  readLocalSqliteCacheWindows,
  upsertLocalSqliteOrganization,
  writeLocalSqliteAppointmentCache,
} from "@/lib/local-sqlite-store";
import { cacheWindowsCoverRange } from "@/lib/serviceminder/appointment-cache";

describe("desktop local SQLite org cache", () => {
  let tempDir: string;

  const context = {
    userId: "desktop-user",
    apiBaseUrl: "https://serviceminder.com/api",
    apiKeyHash: "hash-a",
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ses-dashboard-sqlite-"));
    vi.stubEnv("SES_DASHBOARD_DATA_DIR", tempDir);
  });

  afterEach(async () => {
    closeLocalSqliteStoreForTests();
    vi.unstubAllEnvs();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("creates the dashboard SQLite database under the local data folder", () => {
    expect(localSqlitePath()).toBe(path.join(tempDir, "dashboard.sqlite"));
    writeLocalSqliteAppointmentCache({
      context,
      includeContact: true,
      fromDate: "2026-05-01",
      throughDate: "2026-05-01",
      warning: null,
      records: [],
    });

    expect(localSqliteStats(context)).toEqual({ appointments: 0, organizations: 0 });
  });

  it("upserts organization metadata by org ID and API key hash", () => {
    upsertLocalSqliteOrganization({
      context,
      orgId: "2088",
      name: "Organization 2088",
      displayName: "Organization 2088",
      source: "appointments",
    });
    upsertLocalSqliteOrganization({
      context,
      orgId: "2088",
      name: "Conserva Greenville",
      displayName: "Conserva Greenville",
      source: "organizations",
    });

    expect(listLocalSqliteOrganizations(context)).toMatchObject([
      {
        orgId: "2088",
        name: "Conserva Greenville",
        displayName: "Conserva Greenville",
        source: "organizations",
      },
    ]);
  });

  it("writes appointments with org fields and reads covered date ranges", () => {
    writeLocalSqliteAppointmentCache({
      context,
      includeContact: true,
      fromDate: "2026-05-01",
      throughDate: "2026-05-07",
      warning: null,
      records: [
        {
          recordKey: "appointment:1",
          appointmentId: "1",
          reportDate: "2026-05-02",
          payload: {
            AppointmentId: 1,
            OrganizationId: 2088,
            OrganizationName: "Conserva Greenville",
            Status: "Complete",
          },
        },
      ],
    });

    const windows = readLocalSqliteCacheWindows(context, true);
    expect(cacheWindowsCoverRange(windows, "2026-05-01", "2026-05-07")).toBe(true);
    expect(cacheWindowsCoverRange(windows, "2026-05-01", "2026-05-08")).toBe(false);
    expect(readLocalSqliteAppointmentPayloads({ context, includeContact: true, fromDate: "2026-05-01", throughDate: "2026-05-07" })).toEqual([
      {
        AppointmentId: 1,
        OrganizationId: 2088,
        OrganizationName: "Conserva Greenville",
        Status: "Complete",
      },
    ]);
    expect(listLocalSqliteOrganizations(context)).toMatchObject([{ orgId: "2088", name: "Conserva Greenville" }]);
  });

  it("refresh-style writes replace the existing appointment payload", () => {
    writeLocalSqliteAppointmentCache({
      context,
      includeContact: true,
      fromDate: "2026-05-01",
      throughDate: "2026-05-07",
      warning: null,
      records: [
        {
          recordKey: "appointment:1",
          appointmentId: "1",
          reportDate: "2026-05-02",
          payload: { AppointmentId: 1, OrganizationId: 2088, Status: "Old" },
        },
      ],
    });
    writeLocalSqliteAppointmentCache({
      context,
      includeContact: true,
      fromDate: "2026-05-01",
      throughDate: "2026-05-07",
      warning: null,
      records: [
        {
          recordKey: "appointment:1",
          appointmentId: "1",
          reportDate: "2026-05-02",
          payload: { AppointmentId: 1, OrganizationId: 2088, Status: "Updated" },
        },
      ],
    });

    expect(readLocalSqliteAppointmentPayloads({ context, includeContact: true, fromDate: "2026-05-01", throughDate: "2026-05-07" })).toEqual([
      { AppointmentId: 1, OrganizationId: 2088, Status: "Updated" },
    ]);
  });

  it("isolates cached appointments by API key hash", () => {
    const otherContext = { ...context, apiKeyHash: "hash-b" };
    writeLocalSqliteAppointmentCache({
      context,
      includeContact: true,
      fromDate: "2026-05-01",
      throughDate: "2026-05-07",
      warning: null,
      records: [
        {
          recordKey: "appointment:1",
          appointmentId: "1",
          reportDate: "2026-05-02",
          payload: { AppointmentId: 1, OrganizationId: 2088, Status: "A" },
        },
      ],
    });
    writeLocalSqliteAppointmentCache({
      context: otherContext,
      includeContact: true,
      fromDate: "2026-05-01",
      throughDate: "2026-05-07",
      warning: null,
      records: [
        {
          recordKey: "appointment:1",
          appointmentId: "1",
          reportDate: "2026-05-02",
          payload: { AppointmentId: 1, OrganizationId: 2088, Status: "B" },
        },
      ],
    });

    expect(readLocalSqliteAppointmentPayloads({ context, includeContact: true, fromDate: "2026-05-01", throughDate: "2026-05-07" })).toEqual([
      { AppointmentId: 1, OrganizationId: 2088, Status: "A" },
    ]);
    expect(readLocalSqliteAppointmentPayloads({ context: otherContext, includeContact: true, fromDate: "2026-05-01", throughDate: "2026-05-07" })).toEqual([
      { AppointmentId: 1, OrganizationId: 2088, Status: "B" },
    ]);
  });
});
