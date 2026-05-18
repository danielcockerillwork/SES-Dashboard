import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLocalSavedView,
  deleteLocalSavedView,
  getLocalSettings,
  listLocalSavedViews,
  localDataDir,
  saveLocalSettings,
} from "@/lib/local-store";
import { decryptSecret, encryptSecret } from "@/lib/security";

describe("desktop local JSON store", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ses-dashboard-store-"));
    vi.stubEnv("AUTH_MODE", "desktop");
    vi.stubEnv("SES_DASHBOARD_DATA_DIR", tempDir);
    vi.stubEnv("APP_ENCRYPTION_KEY", "");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("stores settings and encrypts API keys with a local generated key", async () => {
    expect(localDataDir()).toBe(tempDir);

    const encryptedApiKey = await encryptSecret("sm_live_desktop_123456");
    const settings = await saveLocalSettings("desktop-user", {
      apiBaseUrl: "https://serviceminder.com/api",
      encryptedApiKey,
      apiKeyHint: "sm_l...3456",
      includeContactDefault: false,
      excludedServiceNames: ["Drainage Quote"],
      connectionStatus: "configured",
    });

    expect(settings.encryptedApiKey).not.toContain("sm_live_desktop_123456");
    await expect(decryptSecret(settings.encryptedApiKey ?? "")).resolves.toBe("sm_live_desktop_123456");

    const reloaded = await getLocalSettings("desktop-user");
    expect(reloaded.apiKeyHint).toBe("sm_l...3456");
    expect(reloaded.includeContactDefault).toBe(false);
    expect(reloaded.excludedServiceNames).toEqual(["Drainage Quote"]);
  });

  it("creates, lists, and deletes saved views locally", async () => {
    const view = await createLocalSavedView({
      userId: "desktop-user",
      reportType: "conserva-ses-score",
      name: "May completions",
      filters: { from: "2026-05-01", through: "2026-05-31" },
      columns: ["customer", "sesScore"],
    });

    await createLocalSavedView({
      userId: "other-user",
      reportType: "conserva-ses-score",
      name: "Other",
      filters: {},
      columns: [],
    });

    expect(await listLocalSavedViews("desktop-user", "conserva-ses-score")).toMatchObject([
      { id: view.id, name: "May completions" },
    ]);

    await deleteLocalSavedView("desktop-user", view.id);
    expect(await listLocalSavedViews("desktop-user", "conserva-ses-score")).toEqual([]);
  });
});
