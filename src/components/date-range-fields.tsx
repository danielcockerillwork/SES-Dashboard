"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DateRangeFieldsProps = {
  from: string;
  through: string;
  onChange: (value: { from: string; through: string }) => void;
  idPrefix?: string;
};

export function DateRangeFields({ from, through, onChange, idPrefix = "range" }: DateRangeFieldsProps) {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-from`}>From</Label>
        <Input
          id={`${idPrefix}-from`}
          type="date"
          value={from}
          onChange={(event) => onChange({ from: event.target.value, through })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-through`}>Through</Label>
        <Input
          id={`${idPrefix}-through`}
          type="date"
          value={through}
          onChange={(event) => onChange({ from, through: event.target.value })}
        />
      </div>
    </>
  );
}
