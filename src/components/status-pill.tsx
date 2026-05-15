import { Badge } from "@/components/ui/badge";

const labels: Record<string, string> = {
  connected: "Connected",
  configured: "Configured",
  not_configured: "Not configured",
  database_not_configured: "Database needed",
  error: "Error",
};

export function StatusPill({ status }: { status: string }) {
  const variant = status === "connected" ? "good" : status === "error" || status === "database_not_configured" ? "warning" : "secondary";
  return <Badge variant={variant}>{labels[status] ?? status}</Badge>;
}
