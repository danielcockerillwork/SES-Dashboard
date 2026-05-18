/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppointmentHistoryHover } from "@/components/appointment-history-hover";

describe("AppointmentHistoryHover", () => {
  afterEach(() => cleanup());

  it("expands inline on click and shows the current row", () => {
    render(
      <AppointmentHistoryHover
        counts={{ total: 3, completed: 2, upcoming: 1 }}
        summary="3 total · 2 completed · 1 upcoming"
        history={[
          {
            appointmentId: "29",
            appointmentDateTime: "2026-05-01T09:00:00-04:00",
            completedDateTime: "2026-05-01T10:00:00-04:00",
            serviceName: "Consultation",
            status: "Completed",
            isCompleted: true,
            isCurrent: false,
          },
          {
            appointmentId: "30",
            appointmentDateTime: "2026-05-10T09:00:00-04:00",
            completedDateTime: "2026-05-10T10:00:00-04:00",
            serviceName: "Visit",
            status: "Completed",
            isCompleted: true,
            isCurrent: true,
          },
          {
            appointmentId: "31",
            appointmentDateTime: "2026-05-10T11:00:00-04:00",
            completedDateTime: null,
            serviceName: "Inspection",
            status: "Queued",
            isCompleted: false,
            isCurrent: false,
          },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "3 total · 2 completed · 1 upcoming" });
    fireEvent.click(trigger);

    expect(screen.getByText("Appointment summary")).toBeTruthy();
    expect(screen.getByText("Current row")).toBeTruthy();
    expect(screen.getByText("Inspection")).toBeTruthy();
    expect(screen.getByText("2 completed · 1 upcoming")).toBeTruthy();
    expect(screen.getByText("Queued")).toBeTruthy();
  });

  it("falls back to plain text when no history is available", () => {
    const { rerender } = render(
      <AppointmentHistoryHover
        counts={{ total: 1, completed: 1, upcoming: 0 }}
        summary="1 total · 1 completed · 0 upcoming"
        history={[
          {
            appointmentId: "50",
            appointmentDateTime: "2026-05-10",
            completedDateTime: null,
            serviceName: "Inspection",
            status: "Scheduled",
            isCompleted: false,
            isCurrent: true,
          },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "1 total · 1 completed · 0 upcoming" });
    fireEvent.click(trigger);
    expect(screen.getByText("Appointment summary")).toBeTruthy();

    rerender(
      <AppointmentHistoryHover
        counts={{ total: 1, completed: 1, upcoming: 0 }}
        summary="1 total · 1 completed · 0 upcoming"
        history={null}
      />,
    );

    expect(screen.queryByRole("button", { name: "1 total · 1 completed · 0 upcoming" })).toBeNull();
    expect(screen.getByText("1 total · 1 completed · 0 upcoming")).toBeTruthy();
  });
});
