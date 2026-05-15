import { describe, expect, it } from "vitest";
import { appointmentCacheRecordKey, cacheWindowsCoverRange } from "@/lib/serviceminder/appointment-cache";

describe("ServiceMinder appointment cache", () => {
  const now = new Date("2026-05-14T12:00:00.000Z");

  it("treats one fresh superset window as covering a requested range", () => {
    expect(
      cacheWindowsCoverRange(
        [{ fromDate: "2026-05-01", throughDate: "2026-05-31", fetchedAt: now }],
        "2026-05-10",
        "2026-05-14",
        60_000,
        now,
      ),
    ).toBe(true);
  });

  it("stitches adjacent fresh windows together", () => {
    expect(
      cacheWindowsCoverRange(
        [
          { fromDate: "2026-05-08", throughDate: "2026-05-14", fetchedAt: now },
          { fromDate: "2026-05-01", throughDate: "2026-05-07", fetchedAt: now },
        ],
        "2026-05-01",
        "2026-05-14",
        60_000,
        now,
      ),
    ).toBe(true);
  });

  it("rejects stale or gapped coverage", () => {
    const stale = new Date("2026-05-14T10:00:00.000Z");

    expect(
      cacheWindowsCoverRange(
        [{ fromDate: "2026-05-01", throughDate: "2026-05-31", fetchedAt: stale }],
        "2026-05-01",
        "2026-05-31",
        60_000,
        now,
      ),
    ).toBe(false);

    expect(
      cacheWindowsCoverRange(
        [
          { fromDate: "2026-05-01", throughDate: "2026-05-07", fetchedAt: now },
          { fromDate: "2026-05-09", throughDate: "2026-05-14", fetchedAt: now },
        ],
        "2026-05-01",
        "2026-05-14",
        60_000,
        now,
      ),
    ).toBe(false);
  });

  it("uses appointment ids when available and stable payload hashes otherwise", () => {
    expect(appointmentCacheRecordKey("41855785", { AppointmentId: 41855785 })).toBe("appointment:41855785");
    expect(appointmentCacheRecordKey(null, { b: 2, a: 1 })).toBe(appointmentCacheRecordKey(null, { a: 1, b: 2 }));
  });
});
