# Conserva SES Score Dashboard

A Next.js reporting dashboard for Conserva completed appointments and the primary ServiceMinder contact custom field `contact.cust_sesscore`.

## Stack

- Next.js App Router, React, TypeScript, Tailwind
- Clerk authentication with a local development fallback when Clerk keys are not configured
- Prisma with Postgres for encrypted user-level API settings, saved views, and report run audit metadata
- Server-only ServiceMinder API access
- Vitest coverage for SES score extraction, report summaries, settings security, and API paging

## Setup

```bash
npm install
cp .env.example .env
npm run db:push
npm run dev
```

Open `http://localhost:3000`.

To launch the dashboard in one command:

```bash
npm run dashboard
```

## Required Environment Variables

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/neondb?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://USER:PASSWORD@HOST/neondb?sslmode=require"
APP_ENCRYPTION_KEY="replace-with-at-least-32-random-characters"
AUTH_MODE="local"
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL="/dashboard"
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL="/dashboard"
SERVICEMINDER_DEFAULT_BASE_URL="https://serviceminder.com/api"
SERVICEMINDER_MAX_RECORDS="5000"
SERVICEMINDER_APPOINTMENT_CACHE_TTL_SECONDS="86400"
```

`AUTH_MODE=local` enables the single local dashboard user only outside production when Clerk keys are absent. For a short-term private Vercel-only deployment, set `AUTH_MODE=vercel-protected` in Vercel Production and enable Vercel Deployment Protection; the app will use one shared protected dashboard user after Vercel authenticates the visitor.

## Exploratory Appointment Inventory

Before confirming the live ServiceMinder field shape, run:

```bash
SERVICEMINDER_API_KEY="..." npm run explore:appointments -- --from 2026-05-01 --through 2026-05-14
```

The script calls `appointments/query`, checks the primary `contact.cust_sesscore` value, inventories appointment/status fields, and emits redacted representative examples. It reads the API key only from local environment variables and never writes secrets.

To extract one redacted appointment payload for debugging:

```bash
python3 scripts/extract_serviceminder_appointment.py \
  --appointment-id 41855785 \
  --org-id 2088
```

If `appointments/find` cannot return that appointment directly, rerun with a bounded fallback window:

```bash
python3 scripts/extract_serviceminder_appointment.py \
  --appointment-id 41855785 \
  --org-id 2088 \
  --from 2026-01-01 \
  --through 2026-05-14
```

The script prompts for the API key if `--api-key` and `SERVICEMINDER_API_KEY` are not provided. After finding the appointment, it also calls `contacts/locate` with the appointment `ContactId` so the output can confirm whether contact-level custom fields such as SES Score are available to the API key.

If local Python certificate verification fails, the script will use `certifi` automatically when it is installed. You can also pass an explicit CA bundle:

```bash
python3 scripts/extract_serviceminder_appointment.py \
  --appointment-id 41855785 \
  --org-id 2088 \
  --ca-file "$(python3 -c 'import certifi; print(certifi.where())')"
```

Use `--insecure-skip-tls-verify` only as a temporary local debugging fallback.

## Reports

The dashboard focuses on:

- Completed appointment volume
- Appointments with `contact.cust_sesscore`
- Missing SES score queue
- SES score averages, ranges, and trends
- Appointment status/detail fields: org, service, total, first appointment, appointment id, week number, and status
- Technician, service, organization, score range, missing-score, and search filters
- CSV export and saved report views

Mock fixtures are used when no ServiceMinder API key is configured so the UI and tests remain usable without live Conserva data.

Completed ServiceMinder appointment payloads are cached in Postgres after a live report load. Reopening a covered date range uses the cached hydrated appointment records until `SERVICEMINDER_APPOINTMENT_CACHE_TTL_SECONDS` expires. Use the dashboard Refresh button to bypass the cache and replace the stored records for the selected range.

## Deployment

Deploy to Vercel after configuring Clerk, Postgres, encryption, and ServiceMinder environment variables in the Vercel project. Production must have Clerk configured; the app will not fall back to the shared local user there. Disable public sign-up or require invitations in Clerk so shared links only work for approved users. Each signed-in user then saves their own ServiceMinder API key under Settings, and that key is encrypted and scoped to that Clerk user id.

Use preview deployments first, then promote or deploy production after `npm test` and `npm run build` pass locally.
