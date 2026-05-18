"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import type { ContactAppointmentCounts, ContactAppointmentHistoryItem } from "@/lib/serviceminder/types";

type AppointmentHistoryHoverProps = {
  counts: ContactAppointmentCounts;
  history: ContactAppointmentHistoryItem[] | null;
  summary: string;
  label?: ReactNode;
  triggerClassName?: string;
  open?: boolean;
  onToggle?: () => void;
  renderPanel?: boolean;
};

type AppointmentHistoryPanelProps = {
  counts: ContactAppointmentCounts;
  history: ContactAppointmentHistoryItem[] | null;
  summary: string;
};

function hasTime(value: string | null) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && /T|\d:\d/.test(value);
}

function historyDisplayTime(item: ContactAppointmentHistoryItem) {
  const scheduled = item.appointmentDateTime;
  const completed = item.completedDateTime;
  const value = scheduled ?? completed;
  if (!value) return "—";
  return hasTime(value) ? formatDateTime(value) : formatDate(value);
}

function historyStatusLabel(item: ContactAppointmentHistoryItem) {
  const normalized = item.status?.trim().toLowerCase() ?? "";
  if (normalized === "0" || normalized === "queued") return "Queued";
  if (normalized) return item.status!.trim();
  return item.isCompleted ? "Completed" : "Upcoming";
}

export function AppointmentHistoryHover({
  counts,
  history,
  summary,
  label,
  triggerClassName,
  open: controlledOpen,
  onToggle,
  renderPanel = true,
}: AppointmentHistoryHoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const hasHistory = Boolean(history?.length);
  const open = controlledOpen ?? uncontrolledOpen;

  function toggle() {
    if (onToggle) {
      onToggle();
      return;
    }
    setUncontrolledOpen((current) => !current);
  }

  if (!hasHistory) {
    return <span className="text-xs text-muted-foreground">{label ?? summary}</span>;
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "inline-flex w-full items-center gap-2 rounded-md text-left text-xs text-muted-foreground underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          triggerClassName,
        )}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {label ?? summary}
      </button>
      {open && renderPanel ? <AppointmentHistoryPanel counts={counts} history={history} summary={summary} /> : null}
    </div>
  );
}

export function AppointmentHistoryPanel({ counts, history, summary }: AppointmentHistoryPanelProps) {
  return (
    <div className="mt-3 rounded-md border bg-accent/20 p-3 text-popover-foreground">
      <div className="rounded-md border bg-accent/20 p-3">
        <p className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">Appointment summary</p>
        <p className="mt-1 text-sm font-semibold text-foreground">{summary}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {counts.completed ?? 0} completed · {counts.upcoming ?? 0} upcoming
        </p>
      </div>
      <div className="mt-3 space-y-2">
        {history?.map((item, index) => (
          <div
            key={`${item.appointmentId ?? "appointment"}-${item.appointmentDateTime ?? item.completedDateTime ?? index}`}
            className={cn(
              "rounded-md border px-3 py-2",
              item.isCurrent ? "border-primary/40 bg-primary/5" : "bg-background/80",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{item.serviceName?.trim() || "Unnamed appointment"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{historyDisplayTime(item)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {item.isCurrent ? <Badge variant="outline">Current row</Badge> : null}
                <Badge variant={item.isCompleted ? "good" : "secondary"}>{historyStatusLabel(item)}</Badge>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
