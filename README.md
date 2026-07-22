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
warning watermark.

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
can later tombstone deleted profiles without retaining public attributes.
`new_hire_onboarding` owns the stable assigned job title and the confirmation,
conduct-acceptance, and Clock In timestamps. Neither table stores Portal
messages or message bodies.

First-time New Hires enter a three-step New Employee Setup Wizard. Profile
changes are applied to Clerk first and then projected to Neon. The absurd job
title is selected deterministically from the Clerk user ID and inserted once,
so refreshes and concurrent requests cannot reroll it. Clock In uses the same
single onboarding row and preserves its first completion timestamp across
retries. Completed New Hires go directly to the current Office Day; incomplete
New Hires resume from the first missing timestamp.

Mock mode provides isolated first-time and returning fixtures and exercises the
same validation and persistence contract without Clerk or Neon credentials.

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
  executable boundary example.
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
  the live and mock persistence implementations.
- `/api/office/onboarding` authenticates every mutation, updates Clerk before a
  profile projection, and rejects Clock In until required onboarding state is
  durable.
- Browser-facing configuration uses only publishable `NEXT_PUBLIC_*` keys.
  Secret values remain server-only.

Realtime messaging and persistence behavior will be attached behind these
adapters in subsequent delivery slices. Portal channel policy must still enforce
`anonymous: false`; Clerk protection does not replace ADR 0004's Portal-side
authorization boundary.
