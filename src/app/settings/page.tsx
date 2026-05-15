"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, ServerCog } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/utils";
import type { PublicSettings } from "@/lib/settings";

function isPublicSettings(value: unknown): value is PublicSettings {
  return Boolean(
    value &&
      typeof value === "object" &&
      "apiBaseUrl" in value &&
      "apiKeyConfigured" in value &&
      "databaseConfigured" in value,
  );
}

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

function responseMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const record = data as { error?: unknown; lastError?: unknown };
  return typeof record.lastError === "string"
    ? record.lastError
    : typeof record.error === "string"
      ? record.error
      : fallback;
}

function noticeFromSettingsStatus(status: string | null) {
  if (status === "saved") return "Settings saved.";
  if (status === "invalid") return "Enter a valid API base URL before saving settings.";
  if (status === "error") return "Settings could not be saved. Check the database and encryption configuration.";
  return null;
}

function organizationLabel(settings: PublicSettings | null) {
  return settings?.organization?.displayName ?? "Not detected";
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [apiBaseUrl, setApiBaseUrl] = useState("https://serviceminder.com/api");
  const [apiKey, setApiKey] = useState("");
  const [includeContactDefault, setIncludeContactDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const message = noticeFromSettingsStatus(new URLSearchParams(window.location.search).get("settings"));
    if (!message) return;

    const frame = window.requestAnimationFrame(() => setNotice(message));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then(async (response) => {
        const data = await readJson(response);
        if (!response.ok || !isPublicSettings(data)) {
          throw new Error(responseMessage(data, "Settings could not be loaded."));
        }
        return data;
      })
      .then((data) => {
        setSettings(data);
        setApiBaseUrl(data.apiBaseUrl);
        setIncludeContactDefault(data.includeContactDefault);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "Settings could not be loaded."));
  }, []);

  async function saveSettings(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiBaseUrl,
          apiKey,
          includeContactDefault,
        }),
      });
      const data = await readJson(response);
      if (isPublicSettings(data)) setSettings(data);
      if (response.ok) {
        setApiKey("");
        setNotice("Settings saved.");
      } else {
        setNotice(responseMessage(data, "Settings could not be saved."));
      }
    } catch {
      setNotice("Settings could not be saved. Check that the app server is running and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/test", { method: "POST" });
      const data = await readJson(response);
      if (isPublicSettings(data)) setSettings(data);
      setNotice(response.ok ? "Connection test succeeded." : responseMessage(data, "Connection test failed."));
    } catch {
      setNotice("Connection test failed. Check that the app server is running and try again.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <PageHeading
        title="Settings"
        eyebrow="ServiceMinder connection"
        description="Credentials are stored per signed-in user and are never returned to the browser."
      >
        {settings ? <StatusPill status={settings.connectionStatus} /> : null}
      </PageHeading>

      {notice ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>API Connection</CardTitle>
            <CardDescription>Save a ServiceMinder API key for the current dashboard user.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" action="/api/settings" method="post" onSubmit={saveSettings}>
              <div className="grid gap-2">
                <Label htmlFor="apiBaseUrl">API base URL</Label>
                <Input
                  id="apiBaseUrl"
                  name="apiBaseUrl"
                  value={apiBaseUrl}
                  onChange={(event) => setApiBaseUrl(event.target.value)}
                  placeholder="https://serviceminder.com/api"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="apiKey">API key</Label>
                <Input
                  id="apiKey"
                  name="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={settings?.apiKeyHint ?? "Paste ServiceMinder API key"}
                  autoComplete="off"
                />
              </div>
              <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-3">
                <div>
                  <Label htmlFor="includeContactDefault">Include contact details</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Used when report rows need customer names.</p>
                </div>
                <Switch
                  id="includeContactDefault"
                  checked={includeContactDefault}
                  onCheckedChange={setIncludeContactDefault}
                />
                <input type="hidden" name="includeContactDefault" value={includeContactDefault ? "true" : "false"} />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={saving || testing}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save
                </Button>
                <Button
                  type="button"
                  onClick={testConnection}
                  variant="outline"
                  disabled={saving || testing || !settings?.apiKeyConfigured}
                >
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ServerCog className="h-4 w-4" />}
                  Test Connection
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connection Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              {settings ? <StatusPill status={settings.connectionStatus} /> : <span className="h-5 w-24 animate-pulse rounded-md bg-muted" />}
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">API key</span>
              <span className="truncate text-sm font-medium">{settings?.apiKeyHint ?? "Not saved"}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">Organization</span>
              <span className="truncate text-sm font-medium">{organizationLabel(settings)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">Last sync</span>
              <span className="text-sm font-medium">{formatDate(settings?.lastSuccessfulSync)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">Database</span>
              <span className="text-sm font-medium">{settings?.databaseConfigured ? "Configured" : "Missing"}</span>
            </div>
            {settings?.lastError ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
                {settings.lastError}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
