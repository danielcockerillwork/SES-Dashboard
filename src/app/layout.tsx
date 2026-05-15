import type { Metadata } from "next";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Conserva SES Score Dashboard",
  description: "Completed appointment and contact.cust_sesscore reporting for Conserva.",
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const localAuthEnabled = !clerkConfigured && (process.env.NODE_ENV !== "production" || process.env.AUTH_MODE === "local");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shell = (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <div className="min-h-screen">
          <header className="sticky top-0 z-40 border-b bg-background/88 backdrop-blur">
            <div className="flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
              <Link href="/dashboard" className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                  C
                </span>
                <span className="hidden text-sm font-semibold text-foreground sm:inline">
                  Conserva Field Reporting
                </span>
              </Link>
              <nav className="flex items-center gap-2 text-sm">
                <ThemeToggle />
                <Link className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground" href="/dashboard">
                  Dashboard
                </Link>
                <Link className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground" href="/settings">
                  Settings
                </Link>
                {clerkConfigured ? (
                  <div className="flex items-center gap-2">
                    <Link className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground" href="/sign-in">
                      Sign in
                    </Link>
                    <UserButton />
                  </div>
                ) : (
                  <span className="rounded-md border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
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
