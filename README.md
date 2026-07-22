# Portal Messenger: Corporate Edition

Portal Messenger is a forkable Next.js example for building a communal realtime
office with hosted Portal APIs. The application is intentionally safe to run
before Clerk, Portal, or Neon credentials are available.

## Quick Start

The project uses Bun exclusively.

```bash
bun install
cp .env.example .env.local
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) for the static Observer
experience. Entering [http://localhost:3000/office](http://localhost:3000/office)
first presents the deterministic mock sign-in, then opens the authenticated
office seam. Mock authentication and mock services each display a permanent
warning watermark. The returning fixture opens the daily General Office Channel,
where deterministic messages persist across reloads without cloud credentials.

## Runtime Configuration

`APP_ENV` explicitly selects `local`, `test`, `preview`, or `production`.
Vercel's `VERCEL_ENV` selects preview or production when `APP_ENV` is absent.
Local and test modes default to `SERVICE_MODE=mock`; preview and production
default to `SERVICE_MODE=live`.

Live mode requires these variables:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET`
- `NEXT_PUBLIC_PORTAL_KEY`
- `PORTAL_SECRET`
- `DATABASE_URL`

`OPERATOR_CLERK_USER_IDS` is an optional comma- or whitespace-separated list of
exact Clerk user IDs that receive Operator-shaped identity. It is read only on
the server.

Configuration is validated before service adapters are created. Invalid or
partial configuration renders Installation Incomplete and lists only variable
names and reasons. Values are never returned to that screen. The Observer route
does not import the adapter boundary and cannot initialize Portal. Its office
entry links also disable route prefetching, so the office boundary is not
rendered until an Observer explicitly chooses to enter it.

Production (`APP_ENV=production` or `VERCEL_ENV=production`) refuses to build or
start when `SERVICE_MODE=mock` is explicit. Missing production credentials are
allowed through the build so the deployed application can fail closed with the
Installation Incomplete screen.

## Neon and New Employee Setup

Create a Neon Postgres database, put its pooled connection string in
`DATABASE_URL`, and apply committed migrations explicitly before starting a
live deployment:

```bash
bun run db:migrate
```

This command is the only migration execution path. Portal Messenger never runs
migrations during `bun run dev`, application startup, or `bun run build`.

The initial Drizzle migration creates two focused tables. `clerk_profiles`
projects the current Clerk name and picture under the stable Clerk user ID and
orders writes by Clerk's `updated_at` source version so delayed requests cannot
replace newer data. Exact webhook replays do not rewrite the row.
`new_hire_onboarding` owns the stable assigned job title and the confirmation,
conduct-acceptance, and Clock In timestamps. Neither table stores Portal
messages or message bodies.

In the Clerk Dashboard, create a webhook endpoint for
`https://<deployment>/api/webhooks/clerk`, subscribe it to `user.created` and
`user.updated`, and put that endpoint's signing secret in
`CLERK_WEBHOOK_SECRET`. The Node.js route verifies the signature before parsing
profile fields and returns a generic `400` for invalid signatures or payloads;
it does not log secrets or profile data. Clerk's current name and picture are
also projected when an authenticated session is established. That repair uses
the same source-version rule as webhooks, so a stale session read cannot roll a
newer projection backward.

Authenticated server consumers batch attribution through
`POST /api/office/profiles` with `{ "clerkUserIds": [...] }`. A request accepts
at most 100 supplied stable Clerk user IDs, deduplicates them, and performs one
Neon query. Results contain only the stable ID, current display name and
picture, and a status. A
missing projection returns the non-identifying `New Hire`/`unavailable`
fallback. Portal messages keep only the stable Clerk user ID, so both old and
new messages resolve to the latest projection instead of retaining historical
name or picture snapshots.

First-time New Hires enter a three-step New Employee Setup Wizard. Profile
changes are applied to Clerk first and then projected to Neon. The absurd job
title is selected deterministically from the Clerk user ID and inserted once,
so refreshes and concurrent requests cannot reroll it. Clock In uses the same
single onboarding row and preserves its first completion timestamp across
retries. Completed New Hires go directly to the current Office Day; incomplete
New Hires resume from the first missing timestamp.

Mock mode provides isolated first-time and returning fixtures and exercises the
same validation and persistence contract without Clerk or Neon credentials.

## Portal General Office Channel

Portal is the sole authority for live conversation messages and history. Neon
does not store or duplicate message bodies. The first connected Office Channel is
`{YYYY-MM-DD}:general`, where the date is the current UTC Office Day.

Portal dependencies are exact because its APIs are pre-1.0:

- `@portalsdk/core` `0.1.4`
- `@portalsdk/react` `0.1.2`
- `@portalsdk/config` `0.1.4`
- `@portalsdk/cli` `0.4.1`

`bun.lock` is the only lockfile. Update Portal packages deliberately with Bun and
keep each direct version exact.

The root `portal.config.ts` applies `anonymous: false` to every visible and
hidden Office Channel. It deliberately defines no publish middleware or
automated content moderation. Deploy that customer configuration with the
server-only `PORTAL_SECRET` after selecting the correct Portal environment:

```bash
bun run portal:deploy
```

Authenticated entry calls Portal's hosted control plane to upsert the New Hire's
daily General membership, then mints a channel-scoped token with a 15-minute
lifetime. `/api/office/portal/token` performs both operations only after
server-side authentication and completed onboarding. The browser receives the
short-lived user token but never `PORTAL_SECRET`; the published Portal SDK calls
the route again on connection, reconnect, and expiry.

The SDK loads persistent history and owns optimistic `pending`, confirmed
`sent`, and recoverable `failed` delivery states. The app accepts only a runtime-
validated `{ text: string }` payload of 1–1,000 characters. Rendering uses React
text escaping and linkifies only HTTP(S) URLs with a new browsing context and
`noopener noreferrer`. HTML, rich Markdown, uploads, embeds, media, and URL
unfurling are not supported.

Portal connection and publish failures remain visible as offline/retry states.
Live mode never substitutes mock or browser-local messages. Mock chat uses a
separate authenticated test-only route and in-memory Portal adapter; that route
returns 404 outside guarded non-production mock mode.

## Clerk Authentication

In live mode, Clerk's hosted Account Portal owns sign-in. Configure the desired
social connections and email verification-code strategy in the Clerk Dashboard;
Portal Messenger does not add passwords, invitations, organizations, or a
parallel account model. The Clerk publishable and secret keys in `.env.local`
must belong to the same Clerk application. Keep `CLERK_SECRET_KEY` server-only.

Next.js Proxy performs the early signed-out redirect for `/office/*` and rejects
unsigned `/api/office/*` requests. That redirect is only an optimization: every
office page and route handler also calls the server authentication boundary,
which derives the Clerk user and session IDs from Clerk and fetches the current
Clerk profile. Browser headers, form values, and client visibility are never
accepted as identity. Protected pages and route handlers explicitly select the
Node.js runtime.

In local and test mock mode, `/sign-in` offers two fixed identities: a New Hire
and an Operator. The selection is mapped server-side to signed, HTTP-only
session cookies. Arbitrary Clerk IDs and identity headers are ignored. These
sessions are credential-free fixtures, not a Clerk emulator, and are refused
when the application environment is production.

## Checks

All automated checks run without external credentials:

```bash
bun run lint
bunx tsc --noEmit
bun run build
bun run test:unit
bun run test:server
bun run test:browser
```

Install Chromium once before running browser tests locally:

```bash
bunx playwright install chromium
```

## Architecture Boundaries

- `/` is the Observer experience. It uses static fixtures and imports no Clerk,
  Portal, Neon, configuration, or adapter modules. Desktop interactions remain
  local UI state, and small viewports receive a separate non-windowed teaser.
- `/office` is the office entry point. It reads runtime configuration on the
  server, requires a server-verified New Hire identity, and constructs service
  adapters only after both checks pass.
- `/api/office/*` is reserved for authenticated server operations. Each handler
  must call `authenticateOfficeRequest`; the included session endpoint is the
  executable boundary example. Session establishment repairs the current Clerk
  projection, and `/api/office/profiles` provides bounded batch attribution.
- `/api/webhooks/clerk` is a public, Node.js-only delivery endpoint. It accepts
  current profile writes only after Clerk signature verification and applies
  source-version ordering in Neon.
- `src/proxy.ts` performs an early protection check for office pages and server
  operations. It is not the sole authorization boundary.
- `src/lib/auth/` owns Clerk verification, mock sessions, and exact Operator
  allowlist matching. Server-derived identity is passed into office rendering.
- `src/lib/config.ts` owns environment classification and validation.
- `src/lib/adapters/` owns Portal-shaped and Neon-shaped boundaries. It cannot
  determine or override the authenticated identity. Mock data is deterministic
  and cannot be selected in production.
- `src/lib/db/` contains the Drizzle schema and Neon HTTP client boundary.
  `src/lib/onboarding/` owns deterministic assignment, onboarding state, and
  the live and mock persistence implementations. `src/lib/profiles/` owns
  Clerk payload validation, drift repair, and the batch-read contract.
- `/api/office/onboarding` authenticates every mutation, updates Clerk before a
  profile projection, and rejects Clock In until required onboarding state is
  durable.
- `/api/office/portal/token` authenticates the New Hire, checks completed
  onboarding, idempotently grants daily General membership, and mints a
  15-minute Portal user token. It never returns the Portal secret.
- `/api/office/portal/mock-chat` is a guarded non-production adapter route used
  only by the credential-free UI and browser tests. Live chat goes directly
  through the published Portal SDK and hosted APIs.
- Browser-facing configuration uses only publishable `NEXT_PUBLIC_*` keys.
  Secret values remain server-only.
