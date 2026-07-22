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
warning watermark. The returning fixture opens the complete daily Office
Channel directory, where deterministic messages persist across reloads without
cloud credentials.

## Runtime Configuration

`APP_ENV` explicitly selects `local`, `test`, `preview`, or `production`.
Vercel's `VERCEL_ENV` selects preview or production when `APP_ENV` is absent.
Local and test modes default to `SERVICE_MODE=mock`; preview and production
default to `SERVICE_MODE=live`.

Live mode requires these variables:

- `APP_ORIGIN`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET`
- `NEXT_PUBLIC_PORTAL_KEY`
- `PORTAL_SECRET`
- `DATABASE_URL`

`OPERATOR_CLERK_USER_IDS` is an optional comma- or whitespace-separated list of
exact Clerk user IDs that receive Operator-shaped identity. It is read only on
the server.

Use one development Clerk, Portal, and Neon stack for local and preview scopes.
Set the same variable names to a separate production stack in Vercel's
Production environment; production setup verification requires Clerk live keys.
`APP_ORIGIN` is the exact `http://` or `https://` browser origin registered with
Clerk and Portal, with no path or trailing slash.

The repository selects one Vercel Function region in `vercel.json`. Change the
single `regions` entry to the region nearest the production Neon database. This
is deployment configuration, not an environment secret.

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
changes use the same Employee Record editor available after Clock In. The
editor validates names and PNG, JPEG, or WebP pictures up to 2 MB, applies the
change to Clerk first, and preserves entered values across recoverable errors.
The absurd job title is selected deterministically from the Clerk user ID and
inserted once, so refreshes and concurrent requests cannot reroll it. Clock In
uses the same single onboarding row and preserves its first completion
timestamp across retries. Completed New Hires go directly to the current Office
Day; incomplete New Hires resume from the first missing timestamp.

Authenticated New Hires can reopen Employee Record from the Office Channel
panel. `POST /api/office/employee-record` returns either `projected` or
`awaiting_projection` only after Clerk confirms the authoritative write. While
awaiting, the editor keeps an honest status visible and polls the authenticated
`GET` boundary; that boundary runs the same source-ordered repair used during
session establishment. Webhook delivery or repair therefore updates current
and historical attribution without writing identity snapshots into Portal.
Clerk rejection, timeout, partial picture failure, and delayed Neon projection
have distinct recoverable states and never expose provider response details.

Mock mode provides isolated first-time and returning fixtures and exercises the
same validation and persistence contract without Clerk or Neon credentials. In
test mode only, `/api/auth/mock-profile` provides deterministic next-request
rejection, partial-write, and delayed-projection controls for browser coverage;
the route returns `404` in every non-test environment.

## Portal Office Channels and Office Events

Portal is the sole authority for live conversation messages and history. Neon
does not store or duplicate message bodies. Each UTC Office Day has exactly five
visible Office Channels:

| ID | Name | Purpose | Portal mode |
| --- | --- | --- | --- |
| `general:{YYYY-MM-DD}` | General | Company-wide conversation | standard |
| `watercooler:{YYYY-MM-DD}` | Watercooler | Casual conversation and breakroom chatter | standard |
| `tech-support:{YYYY-MM-DD}` | Technical Support | Comedic technical support for suspicious office technology | standard |
| `urgent:{YYYY-MM-DD}` | Urgent | Urgent workplace chatter | standard |
| `all-hands:{YYYY-MM-DD}` | All Hands | System Events and company-wide announcements | broadcast |

IDs contain only the curated channel slug and UTC Office Day. They deliberately
omit branch, deployment, tenant, user, and internal alias namespaces.

Portal dependencies are exact because its APIs are pre-1.0:

- `@portalsdk/core` `0.1.4`
- `@portalsdk/react` `0.1.2`
- `@portalsdk/config` `0.1.4`
- `@portalsdk/cli` `0.4.1`

`bun.lock` is the only lockfile. Update Portal packages deliberately with Bun and
keep each direct version exact.

The root `portal.config.ts` applies `anonymous: false` to every visible and
hidden Office Channel. Its more specific `all-hands:*` template repeats that
authentication setting and selects broadcast mode; Portal channel configuration
entries do not merge. Broadcast mode changes presence and presentation, not
publish authorization, so authenticated New Hires may still participate. The
configuration deliberately defines no publish middleware or automated content
moderation. Deploy it with the server-only `PORTAL_SECRET` after selecting the
correct Portal environment:

```bash
bun run portal:deploy
```

Authenticated entry calls Portal's hosted control plane to upsert the New Hire's
membership in all five daily Office Channels and one
`office-events:{YYYY-MM-DD}` channel, then mints an office-scoped token with a
15-minute lifetime. `/api/office/portal/token` performs both operations only
after server-side authentication and completed onboarding. Repeated token
refreshes upsert the same memberships. The hidden Office Event channel is not
returned by the visible channel adapter. The browser receives the short-lived
user token but never `PORTAL_SECRET`; the published Portal SDK calls the route
again on connection, reconnect, and expiry.

The SDK loads the 50 most recent persistent messages and paginates backward. Its
sequence-aware buffer prevents history duplicates and gap-fills reconnects. The
interface anchors the scroll position when older pages are prepended and keeps
each mounted Office Channel's draft, optimistic `pending`, confirmed `sent`,
recoverable `failed`, loading, pagination, unread, and reconnect state while the
New Hire switches channels. Canonical Portal event timestamps are formatted in
the browser's local timezone. The app accepts only a runtime-
validated `{ text: string }` payload of 1–1,000 characters. Rendering uses React
text escaping and linkifies only HTTP(S) URLs with a new browsing context and
`noopener noreferrer`. HTML, rich Markdown, uploads, embeds, media, and URL
unfurling are not supported.

The Office Day is the pure UTC date of the current instant. A client monitor
arms for the next UTC boundary and also rechecks at least once per minute and
after visibility, page-show, focus, and online recovery events, so sleep,
background timer throttling, network recovery, and wall-clock changes cannot
leave an open office on an expired day. When the date changes, the Portal
provider and every visible and hidden channel subscription are unmounted before
an accessible shift-ended dialog appears. This clears drafts, optimistic sends,
typing, unread, pagination, and other ephemeral state and prevents any
reconnection until the New Hire continues. Continuation always calculates the
latest Office Day rather than assuming only one day elapsed.

Every token response includes the server-selected visible and hidden channel
IDs. The SDK callback accepts that token only when all IDs match the Office Day
currently rendered; a refresh or reconnect for another day returns to the
shift-ended interstitial instead of silently connecting stale UI. Portal retains
older persistent history, while every timestamp that remains visible is
formatted from its canonical instant in the browser's local timezone.

Portal connection and publish failures remain visible as offline/retry states.
Live mode never substitutes mock or browser-local messages. Mock chat uses a
separate authenticated test-only route and in-memory Portal adapter; that route
returns 404 outside guarded non-production mock mode.

### Office Event v1 contract

Office Events are persistent Portal messages with Portal message type
`office.event`; they are not ordinary conversation messages. Their content is an
exact, runtime-validated object with `version: 1`, a supported `type`, a
canonical ISO `occurredAt` timestamp, and a deterministic event key shaped as
`office-event:v1:{type}:{stable-source-id}`. Retrying the same source operation
must reuse its key; a later operation must use a new source ID. Payloads larger
than Portal's 2 KiB content limit, extra fields, malformed identifiers or
timestamps, unknown versions or types, ephemeral/retracted envelopes, and
wrong-channel envelopes are ignored before dispatch.

The supported v1 events are:

- `reaction.changed`: authoritative add/remove operations containing only the
  visible Office Channel ID, message ID, actor ID, and one fixed reaction from
  `👍 ❤️ 😂 😮 😢 🎉`. The verified Portal sender must equal the actor.
- `profile.invalidated`: a `profileId` reference, accepted only from
  `office-events:profiles`.
- `report.invalidated`, `message-removal.invalidated`,
  `employment.invalidated`, and `operator.invalidated`: one type-appropriate ID
  reference, accepted only from `office-events:operations`.

Invalidations never carry names, report details, removal state, employment
state, or Operator state. Consumers refetch the corresponding Neon-owned query;
only reaction events are folded as canonical Portal-owned state. The typed
subscriber exposes separate reaction and invalidation callbacks, deduplicates
retries and reconnect replay by event key, pages through the current Office
Day's event history to rebuild reaction state, and exposes neither the
underlying message list nor a generic event-channel send function.

The subscriber advances the event channel read position, durably mutes its
Portal inbox entry, and clears that entry's independent inbox watermark. Product
channel lists also exclude the event channel, so Office Events do not render as
messages, appear as visible channels, or contribute to user-facing attention.

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

Validate a fork before launch with:

```bash
bun run setup:check
```

`bun run portal:verify` is an explicit alias for the same comprehensive check so
Portal policy cannot be evaluated without its Clerk and Neon readiness context.
The command checks environment shape; Neon connectivity and committed migration
hashes; the Clerk credential environment and observable webhook-secret contract;
and Portal anonymous refusal, authenticated membership and standard mode,
publishing, allowed and unregistered origins, and history after a fresh
connection.

Portal verification creates an isolated synthetic New Hire membership and sends
one small `setup-verification` message to the current General Office Channel.
That message is intentionally persistent so reconnect history can be proven. The
command never prints its body, ID, credentials, connection strings, profile data,
or upstream response bodies.

Exit codes are stable: `0` means every required check passed, `1` means a check
failed (or production proof is incomplete), and `2` means non-production live
proof was unavailable because the checker is in mock mode or credentials are
missing. Corrective output contains variable names and categories only. Clerk's
API proves that the key pair works and belongs to the expected development or
production stack; confirm in the Clerk Dashboard that the endpoint
`<APP_ORIGIN>/api/webhooks/clerk` subscribes to `user.created` and
`user.updated`, because subscription details are not exposed by the credential
check.

After `bun run setup:check` reports migration drift, apply only the committed
Drizzle migrations and check again:

```bash
bun run db:migrate
bun run setup:check
```

Neither setup check executes migrations. Migrations remain absent from build,
development startup, and application startup.

## Repository Verification

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

Browser boundary tests control both clocks with Playwright and the
`x-portal-mock-now` request header. The server honors that header only when
`APP_ENV=test` and `SERVICE_MODE=mock`; live and production requests always use
the server clock.

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
- `src/lib/office-events/` owns the versioned Office Event runtime contract,
  reserved-sender checks, reaction projection, replay deduplication, and the
  narrow browser subscription that isolates event-channel inbox attention.
- `/api/office/onboarding` authenticates every mutation, updates Clerk before a
  profile projection, and rejects Clock In until required onboarding state is
  durable.
- `/api/office/employee-record` authenticates every read and mutation. Writes
  update Clerk before confirming onboarding or inspecting Neon; reads repair
  and report projection convergence without treating Neon as profile authority.
- `/api/office/portal/token` authenticates the New Hire, checks completed
  onboarding, idempotently grants all five daily Office Channel memberships and
  the hidden Office Event membership, and mints a 15-minute Portal user token
  scoped to all six. It never returns the Portal secret.
- `/api/office/portal/mock-chat` is a guarded non-production adapter route used
  only by the credential-free UI and browser tests. Live chat goes directly
  through the published Portal SDK and hosted APIs.
- Browser-facing configuration uses only publishable `NEXT_PUBLIC_*` keys.
  Secret values remain server-only.
