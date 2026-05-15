import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
  tone?: "default" | "good" | "warning" | "info";
  selected?: boolean;
  onClick?: () => void;
};

const tones = {
  default: "bg-muted text-muted-foreground",
  good: "bg-accent text-accent-foreground dark:bg-secondary/15 dark:text-accent-foreground",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  info: "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary",
};

export function MetricCard({ label, value, detail, icon: Icon, tone = "default", selected = false, onClick }: MetricCardProps) {
  const interactive = Boolean(onClick);

  return (
    <Card
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!interactive) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        interactive &&
          "cursor-pointer transition-colors hover:border-primary/60 hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary bg-primary/5 ring-1 ring-primary/35 dark:bg-primary/10",
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 break-words text-2xl font-semibold tracking-normal text-foreground">{value}</p>
            {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
          </div>
          <span className={cn("rounded-md p-2", tones[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
