import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export function isClerkConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

export function isLocalAuthEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.AUTH_MODE === "local";
}

export async function getCurrentUserId() {
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
