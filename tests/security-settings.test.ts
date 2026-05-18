import { describe, expect, it } from "vitest";
import { apiKeyHint, decryptSecret, encryptSecret } from "@/lib/security";
import { parseExcludedServiceNames, publicSettings } from "@/lib/settings";

describe("settings security", () => {
  it("normalizes excluded service names", () => {
    expect(parseExcludedServiceNames([" Repair Visit ", "Repair Visit", "", 4, null])).toEqual(["Repair Visit"]);
  });

  it("encrypts and decrypts API keys without exposing the raw key in public settings", async () => {
    process.env.APP_ENCRYPTION_KEY = "test-encryption-key-that-is-long-enough";
    const encrypted = await encryptSecret("sm_live_123456789");

    expect(encrypted).not.toContain("sm_live_123456789");
    await expect(decryptSecret(encrypted)).resolves.toBe("sm_live_123456789");
    expect(apiKeyHint("sm_live_123456789")).toBe("sm_l…6789");

    const settings = publicSettings({
      id: 1,
      userId: "user_123",
      apiBaseUrl: "https://serviceminder.com/api",
      encryptedApiKey: encrypted,
      apiKeyHint: "sm_l…6789",
      includeContactDefault: true,
      excludedServiceNames: ["New System Quote", "Drainage Quote"],
      connectionStatus: "connected",
      lastSuccessfulSync: new Date("2026-05-14T12:00:00.000Z"),
      lastError: null,
      createdAt: new Date("2026-05-14T12:00:00.000Z"),
      updatedAt: new Date("2026-05-14T12:00:00.000Z"),
    });

    expect(settings.apiKeyConfigured).toBe(true);
    expect(settings.excludedServiceNames).toEqual(["New System Quote", "Drainage Quote"]);
    expect(settings).not.toHaveProperty("encryptedApiKey");
    expect(JSON.stringify(settings)).not.toContain("sm_live_123456789");
  });
});
