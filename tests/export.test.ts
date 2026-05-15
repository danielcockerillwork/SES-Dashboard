import { describe, expect, it } from "vitest";
import { conservaRowsToCsv } from "@/lib/export";
import { normalizeAppointment } from "@/lib/serviceminder/reporting";

describe("Conserva CSV export", () => {
  it("exports split contact appointment counts", () => {
    const row = normalizeAppointment({
      AppointmentId: 21,
      DateTime: "2026-05-10T09:00:00-04:00",
      ActualFinish: "2026-05-10T10:00:00-04:00",
      Status: "Complete",
      ContactAppointmentCounts: {
        total: 3,
        completed: 1,
        upcoming: 2,
      },
    });

    const csv = conservaRowsToCsv([row]);

    expect(csv.split("\n")[0]).toContain("Total Appointments,Completed Appointments,Upcoming Appointments");
    expect(csv.split("\n")[1]).toContain("3,1,2");
  });
});
