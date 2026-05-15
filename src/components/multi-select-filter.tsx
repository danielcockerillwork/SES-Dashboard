"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const selectClassName =
  "h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring";

type MultiSelectFilterProps = {
  id: string;
  label: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  summary: (selected: string[]) => string;
  emptySelectionLabel?: string;
  className?: string;
};

export function MultiSelectFilter({
  id,
  label,
  options,
  value,
  onChange,
  summary,
  emptySelectionLabel = "All options",
  className,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const selected = new Set(value);

  function toggleOption(option: string) {
    const next = selected.has(option) ? value.filter((item) => item !== option) : [...value, option];
    onChange(next);
  }

  return (
    <div className={cn("relative grid gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`${selectClassName} flex items-center justify-between gap-2 text-left`}
      >
        <span className="truncate">{summary(value)}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-72 overflow-y-auto rounded-md border bg-card p-2 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2">
            <span className="px-2 text-xs font-medium text-muted-foreground">
              {value.length ? `${value.length} selected` : emptySelectionLabel}
            </span>
            {value.length ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Clear
              </button>
            ) : null}
          </div>
          <div role="listbox" aria-multiselectable="true" className="grid gap-1">
            {options.map((option) => (
              <label key={option} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-accent">
                <input
                  type="checkbox"
                  checked={selected.has(option)}
                  onChange={() => toggleOption(option)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span className="truncate">{option}</span>
              </label>
            ))}
            {!options.length ? <p className="px-2 py-2 text-sm text-muted-foreground">No options available.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
