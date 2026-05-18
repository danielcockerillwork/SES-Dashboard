export const DESKTOP_USER_ID = "desktop-user";

export function isDesktopMode() {
  return process.env.AUTH_MODE === "desktop" || process.env.ELECTRON_APP === "1";
}

export function isLocalSingleUserMode() {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_MODE === "local";
}
