import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentUserId, isClerkConfigured, isLocalAuthEnabled, isVercelProtectedAuthEnabled } from "@/lib/auth";

const clerkAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: clerkAuthMock,
}));

describe("dashboard authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clerkAuthMock.mockReset();
  });

  it("does not fall back to the shared local user in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "local");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("CLERK_SECRET_KEY", "");

    expect(isLocalAuthEnabled()).toBe(false);
    await expect(getCurrentUserId()).resolves.toBeNull();
  });

  it("uses the local dashboard user only when local mode is enabled outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_MODE", "local");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("CLERK_SECRET_KEY", "");

    expect(isLocalAuthEnabled()).toBe(true);
    await expect(getCurrentUserId()).resolves.toBe("local-user");
  });

  it("uses Clerk user ids when Clerk is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_123");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_123");
    clerkAuthMock.mockResolvedValue({ userId: "user_123" });

    await expect(getCurrentUserId()).resolves.toBe("user_123");
    expect(clerkAuthMock).toHaveBeenCalledOnce();
  });

  it("uses the shared Vercel-protected user when deployment protection is the auth gate", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "vercel-protected");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_123");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_123");

    expect(isVercelProtectedAuthEnabled()).toBe(true);
    expect(isClerkConfigured()).toBe(false);
    await expect(getCurrentUserId()).resolves.toBe("vercel-protected-user");
    expect(clerkAuthMock).not.toHaveBeenCalled();
  });
});
