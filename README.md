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
experience and [http://localhost:3000/office](http://localhost:3000/office) for
the authenticated-office seam. The example environment selects guarded mock
adapters and displays a permanent `MOCK SERVICES - NO LIVE DATA` watermark.

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

Configuration is validated before service adapters are created. Invalid or
partial configuration renders Installation Incomplete and lists only variable
names and reasons. Values are never returned to that screen. The Observer route
does not import the adapter boundary and cannot initialize Portal.

Production (`APP_ENV=production` or `VERCEL_ENV=production`) refuses to build or
start when `SERVICE_MODE=mock` is explicit. Missing production credentials are
allowed through the build so the deployed application can fail closed with the
Installation Incomplete screen.

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
  Portal, Neon, configuration, or adapter modules.
- `/office` is the office entry point. It reads runtime configuration on the
  server and constructs explicit adapters only after validation.
- `src/lib/config.ts` owns environment classification and validation.
- `src/lib/adapters/` owns the Clerk-shaped, Portal-shaped, and Neon-shaped
  boundaries. Mock data is deterministic and cannot be selected in production.
- Browser-facing configuration uses only publishable `NEXT_PUBLIC_*` keys.
  Secret values remain server-only.

Service-specific authentication, realtime messaging, and persistence behavior
will be attached behind these adapters in subsequent delivery slices.
