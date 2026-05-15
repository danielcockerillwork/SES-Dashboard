import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatNumber(value: number | null | undefined, options: Intl.NumberFormatOptions = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", options).format(value);
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${formatNumber(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

export function formatScore(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return formatNumber(value, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 2,
  });
}

export function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export type DateRangePreset =
  | "last-7-days"
  | "last-30-days"
  | "last-90-days"
  | "this-month"
  | "last-month"
  | "year-to-date"
  | "custom";

export const dateRangePresets: Array<{ value: DateRangePreset; label: string }> = [
  { value: "last-7-days", label: "Last 7 days" },
  { value: "last-30-days", label: "Last 30 days" },
  { value: "last-90-days", label: "Last 90 days" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "year-to-date", label: "Year to date" },
  { value: "custom", label: "Custom" },
];

function localIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function relativeDateRange(preset: DateRangePreset, today = new Date()): { from: string; through: string } {
  const through = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const from = new Date(through);

  switch (preset) {
    case "last-7-days":
      from.setDate(through.getDate() - 6);
      break;
    case "last-30-days":
      from.setDate(through.getDate() - 29);
      break;
    case "last-90-days":
      from.setDate(through.getDate() - 89);
      break;
    case "this-month":
      from.setDate(1);
      break;
    case "last-month":
      from.setMonth(through.getMonth() - 1, 1);
      through.setDate(0);
      break;
    case "year-to-date":
      from.setMonth(0, 1);
      break;
    case "custom":
      return relativeDateRange("last-7-days", today);
  }

  return {
    from: localIsoDate(from),
    through: localIsoDate(through),
  };
}

export function defaultDateRange(): { from: string; through: string } {
  return relativeDateRange("last-7-days");
}
