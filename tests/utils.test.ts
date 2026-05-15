import { describe, expect, it } from "vitest";
import { relativeDateRange } from "@/lib/utils";

describe("date range presets", () => {
  const today = new Date(2026, 4, 14);

  it("calculates rolling relative ranges", () => {
    expect(relativeDateRange("last-7-days", today)).toEqual({
      from: "2026-05-08",
      through: "2026-05-14",
    });
    expect(relativeDateRange("last-30-days", today)).toEqual({
      from: "2026-04-15",
      through: "2026-05-14",
    });
    expect(relativeDateRange("custom", today)).toEqual({
      from: "2026-05-08",
      through: "2026-05-14",
    });
  });

  it("calculates calendar-relative ranges", () => {
    expect(relativeDateRange("this-month", today)).toEqual({
      from: "2026-05-01",
      through: "2026-05-14",
    });
    expect(relativeDateRange("last-month", today)).toEqual({
      from: "2026-04-01",
      through: "2026-04-30",
    });
    expect(relativeDateRange("year-to-date", today)).toEqual({
      from: "2026-01-01",
      through: "2026-05-14",
    });
  });
});
