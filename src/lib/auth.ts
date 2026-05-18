import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { DESKTOP_USER_ID, isDesktopMode, isLocalSingleUserMode } from "@/lib/runtime";

export function isClerkConfigured() {
  if (isDesktopAuthEnabled()) return false;
  if (isVercelProtectedAuthEnabled()) return false;
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

export function isVercelProtectedAuthEnabled() {
  return process.env.AUTH_MODE === "vercel-protected";
}

export function isLocalAuthEnabled() {
  return isLocalSingleUserMode();
}

export function isDesktopAuthEnabled() {
  return isDesktopMode();
}

export async function getCurrentUserId() {
  if (isDesktopAuthEnabled()) {
    return DESKTOP_USER_ID;
  }

  if (isVercelProtectedAuthEnabled()) {
    return "vercel-protected-user";
  }

  if (!isClerkConfigured()) {
    return isLocalAuthEnabled() ? "local-user" : null;
  }

  const { userId } = await auth();
  return userId;
}

export async function requireCurrentUserId() {
  return getCurrentUserId();
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
