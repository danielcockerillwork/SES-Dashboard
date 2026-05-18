import type { Metadata } from "next";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { isDesktopAuthEnabled, isVercelProtectedAuthEnabled } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Conserva SES Score Dashboard",
  description: "Completed appointment and contact.cust_sesscore reporting for Conserva.",
  icons: {
    icon: "/brand/ses-mark.png",
    apple: "/brand/ses-mark.png",
  },
};

const vercelProtectedAuthEnabled = isVercelProtectedAuthEnabled();
const desktopAuthEnabled = isDesktopAuthEnabled();
const clerkConfigured = !desktopAuthEnabled && !vercelProtectedAuthEnabled && Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const localAuthEnabled = !clerkConfigured && process.env.NODE_ENV !== "production" && process.env.AUTH_MODE === "local";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shell = (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <div className="min-h-screen">
          <header className="sticky top-0 z-40 border-b border-primary/15 bg-background/92 backdrop-blur">
            <div className="flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
              <Link href="/dashboard" className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-background shadow-sm ring-1 ring-primary/20">
                  <Image
                    src="/brand/ses-mark.png"
                    alt="SES Sprinkler System Evaluation Score"
                    width={156}
                    height={158}
                    priority
                    className="h-8 w-auto rounded-full"
                  />
                </span>
                <span className="hidden leading-tight sm:inline">
                  <span className="block text-sm font-semibold text-foreground">Conserva Field Reporting</span>
                  <span className="block text-[11px] font-medium text-primary">SES Score Dashboard</span>
                </span>
              </Link>
              <nav className="flex items-center gap-2 text-sm">
                <ThemeToggle />
                <Link className="rounded-md px-3 py-2 font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground" href="/dashboard">
                  Dashboard
                </Link>
                <Link className="rounded-md px-3 py-2 font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground" href="/settings">
                  Settings
                </Link>
                {clerkConfigured ? (
                  <div className="flex items-center gap-2">
                    <Link className="rounded-md px-3 py-2 font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground" href="/sign-in">
                      Sign in
                    </Link>
                    <UserButton />
                  </div>
                ) : desktopAuthEnabled ? (
                  <span className="rounded-md border border-primary/15 bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-foreground">
                    Desktop mode
                  </span>
                ) : vercelProtectedAuthEnabled ? (
                  <span className="rounded-md border border-primary/15 bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-foreground">
                    Vercel protected
                  </span>
                ) : (
                  <span className="rounded-md border border-primary/15 bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-foreground">
                    {localAuthEnabled ? "Local mode" : "Auth setup needed"}
                  </span>
                )}
              </nav>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );

  return clerkConfigured ? <ClerkProvider>{shell}</ClerkProvider> : shell;
}
