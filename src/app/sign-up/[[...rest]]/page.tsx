import { SignUp } from "@clerk/nextjs";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isVercelProtectedAuthEnabled } from "@/lib/auth";

export default function SignUpPage() {
  if (isVercelProtectedAuthEnabled()) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-4">
        <Card>
          <CardHeader>
            <Image
              src="/brand/ses-mark.png"
              alt="SES Sprinkler System Evaluation Score"
              width={156}
              height={158}
              className="mb-2 h-12 w-auto rounded-full"
            />
            <CardTitle>Vercel Protected</CardTitle>
            <CardDescription>
              User invitations are handled through Vercel project access while Deployment Protection is enabled.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Continue to the dashboard from the top navigation.
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    const localAuthEnabled = process.env.NODE_ENV !== "production" && process.env.AUTH_MODE === "local";

    return (
      <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-4">
        <Card>
          <CardHeader>
            <Image
              src="/brand/ses-mark.png"
              alt="SES Sprinkler System Evaluation Score"
              width={156}
              height={158}
              className="mb-2 h-12 w-auto rounded-full"
            />
            <CardTitle>{localAuthEnabled ? "Local Auth Mode" : "Authentication Not Configured"}</CardTitle>
            <CardDescription>
              {localAuthEnabled
                ? "Clerk keys are not configured, so account creation is disabled while the app uses the local dashboard user."
                : "Clerk keys are not configured. Add Clerk environment variables to enable sign-up."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Continue to the dashboard from the top navigation.
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <SignUp />
    </main>
  );
}
