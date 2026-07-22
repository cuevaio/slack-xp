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
- `CRON_SECRET`

`OPERATOR_CLERK_USER_IDS` is an optional comma- or whitespace-separated list of
exact Clerk user IDs that receive Operator-shaped identity. It is read only on
the server and re-read for every Operator query and mutation. An empty value or
any malformed entry makes the entire allowlist grant no Operator access. Mock
mode uses the same allowlist contract; the browser fixture configures
`user_mock_operator` explicitly.

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
messages or message bodies. The next migration adds
`profile_invalidation_outbox`, which stores only a deterministic event key, the
stable Clerk user ID, delivery timestamps, and no name, picture, or message
content. A profile upsert and its outbox insert run in one Neon transaction;
Portal publishing starts only after that transaction commits.
The Office Day migration adds `office_days` and
`scripted_system_event_outbox`. The outbox stores deterministic script,
channel, and Office Character references plus due, attempt, acknowledgement,
and creation timestamps; fixed message text remains in source control and is
not copied into Neon. The Office Day row and all five planned outbox rows are
created in one idempotent Neon transaction.

The HR Report migrations add `hr_reports` and
`hr_report_notification_outbox`. Each report identifies a `message` or
`profile` subject. A message report stores its reporter, Office Day, Office
Channel and message identifiers; a New Hire Profile report stores its reporter
and the stable Clerk subject ID. Both store only an approved type-specific
category, open workflow state, and timestamps. They never copy message bodies,
profile names, pictures, preview text, presence, unread state, or unrelated
Clerk data. Separate partial unique indexes allow one open report per reporter
and message or per reporter and profile. The report and pending notification
row commit together so retries return `already-reported` without creating
another workflow record. The profile subject is deliberately not a foreign key:
a later profile tombstone does not remove or rewrite the private review record.
The review migration adds one-way dismissal columns and `operator_actions`.
Each dismissal updates an open report and inserts one uniquely constrained audit
record in the same Neon transaction. The audit stores the acting Operator ID,
HR Report target, `dismissed` action, action and creation timestamps, and an
optional private note of at most 1,000 characters. Retry and concurrent calls
return the existing dismissed state without reopening the report or adding a
second audit.

The Send Home migration adds `employment_actions` and
`employment_effect_outbox`, extends the private Operator audit to employment
actions, and lets a related open HR Report transition to `actioned` in the same
transaction. A Send Home record contains stable actor and target IDs, the UTC
Office Day, its exact next-midnight expiry, an optional stable report reference,
and a retry key. The required private reason exists only in the Operator audit;
the effect outbox contains delivery timestamps but no reason or HR Report
category. One unique action per New Hire and Office Day plus the retry key makes
repeated requests converge on the same audit and effects.

After commit, Portal Messenger publishes a privacy-safe all-hands System Event
and a stable `employment.invalidated` hint, then applies an expiring Portal ban
to all five visible daily Office Channels and the hidden daily Office Event
channel. The System Event identifies the Operator, target, action, and expiry,
but never includes the private reason, report category, reporter, or report ID.
Portal closes active connections; page entry, token refresh, token minting,
membership repair, and reconnect also consult canonical Neon employment state
before granting access. At the next UTC Office Day the Neon action is expired
and the new channel IDs are eligible without treating stale prior-day Portal
bans as current policy. Send Home does not create or reverse a Termination.

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
name or picture snapshots. TanStack Query owns these browser profile batches
under sorted keys shaped as `["new-hire-profiles", clerkUserIds]`; Portal chat
messages remain exclusively in the Portal SDK rather than being copied into the
query cache.

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

The authenticated client also mounts Portal's inbox subscription for the whole
Office Day. The fixed directory order remains product-curated while each row's
unread count and latest conversation preview are reconciled from Portal inbox
entries after initial connection and reconnect. Preview text passes the same
plain-text runtime validation as chat, and sender IDs resolve only to the
current New Hire's known profile or the non-identifying `New Hire` fallback.
The desktop directory and taskbar expose the same row projection. On mobile,
the directory becomes a full-screen navigation surface and returns focus to the
conversation navigation control after selection.

Portal's channel read position and its independent inbox-row position advance
only after the selected conversation has loaded and its surface is actually
visible in the active browser tab. Prefetching every Office Channel, selecting
one behind the mobile directory, or receiving activity elsewhere does not clear
attention. This state is never copied into Neon or treated as browser-local
authority. Guarded mock mode implements the same contract with server-owned
per-fixture watermarks and snapshot polling solely for deterministic browser
tests; live mode has no polling or application fallback for Portal unread state.

Confirmed messages expose an accessible private HR Report dialog with four
server-validated message categories. Current names and pictures open a canonical
New Hire Profile context with three server-validated profile categories.
`POST /api/office/hr-reports` requires a completed, authenticated New Hire. It
accepts either the current Office Day's curated Office Channel plus a stable
message ID, or a currently projected stable Clerk profile ID; mutable names and
pictures are never accepted. After the Neon transaction commits, a hidden
`hr-reports` Portal channel sends each configured Operator a targeted inbox item;
targeted delivery skips public fan-out. Each notification identifies the report
type and links either to message coordinates or `/office?profile=<stable-id>`.
It never contains the private category, reporter, message text, name, picture,
or other mutable profile value. Failed notification delivery leaves the outbox
row pending for a safe retry on a later report submission or Portal-token
refresh. Profile links resolve the current Neon projection at review time, so
edits appear immediately and tombstoned profiles render as Former Employee
without breaking the stable review context.

Operators see a canonical in-messenger HR Review Queue backed by
`GET /api/office/operator/hr-reports`. It distinguishes message and profile
reports plus open and dismissed state, and its context links use the same stable
message coordinates or current New Hire Profile lookup as notifications.
`PATCH /api/office/operator/hr-reports` accepts only a stable report ID and an
optional private note, then performs the validated one-way dismissal. Both
methods authenticate the current Clerk session, require completed onboarding,
and re-evaluate `OPERATOR_CLERK_USER_IDS`; UI visibility and client claims are
never authorization boundaries. The queue and Operator status have separate
TanStack Query caches with periodic repair. Trusted `report.invalidated` and
`operator.invalidated` Office Events narrowly invalidate those caches and never
carry canonical state or private notes.

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

At midnight UTC, Vercel invokes `GET /api/cron/office-days` using
`Authorization: Bearer $CRON_SECRET`. The route creates the current Office Day,
publishes every due scripted System Event, and reports a retryable failure when
any delivery remains pending. The first authenticated Portal-token request also
runs the same idempotent repair, covering delayed or missed Cron delivery
without preventing the New Hire from entering if the repair itself is
temporarily unavailable.

Scripted System Events use the persistent Portal message type `system.event`.
Their event keys are `system-event:v1:{office-day}:{script-id}` and stay stable
across every retry. Neon records an attempt before Portal publishing and records
success only after Portal returns a message acknowledgement. If acknowledgement
state is lost, a retry may create another Portal delivery; clients validate the
fixed script/sender/channel tuple and collapse repeated deliveries by event key.

Three original, fixed Office Characters—Barb Dwyer, Chip Ramsey, and Dot
Matrix—author the five checked-in scripts. The interface labels each one
`Office Character · Fictional`. These identities can publish only System
Events: they are rejected from ordinary New Hire messages and filtered from
presence and typing, and they never enter onboarding or HR employment records.
No generated text or generative AI is used.

Portal connection and publish failures remain visible as offline/retry states.
Live mode never substitutes mock or browser-local messages. Mock chat uses a
separate authenticated test-only route and in-memory Portal adapter; that route
returns 404 outside guarded non-production mock mode.

Standard Office Channels render Portal's detailed live presence only while the
channel socket is current. Each non-anonymous participant's stable Clerk user ID
is batch-resolved through `POST /api/office/profiles`; the UI shows an explicit
lookup state and hides the roster if the profile projection cannot be read.
All-hands renders only Portal's aggregate count and never turns broadcast
presence into a fabricated participant list. Connecting, connected,
reconnecting, and offline states are distinct, and cached presence and typing
are hidden whenever the realtime connection is not current.

Composer changes call Portal's transient `sendTyping()` activity API on standard
channels. The pinned SDK throttles typing pulses to one every three seconds and
expires a peer's last pulse after five seconds. Sending, blurring, switching
channels, and disconnecting stop further pulses, so stale activity expires
without being persisted; Portal ignores typing entirely on broadcast channels.
IDs under `office-character:` and the existing `office-events:` reserved sender
namespace are rejected by the controlled connection contract and filtered from
profile lookup, detailed presence, and typing. Office Characters publish only
scripted System Events and never connect as New Hires.

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
  Office Day, visible Office Channel ID, message ID, actor ID, operation, and
  one fixed reaction from `👍 ❤️ 😂 😮 😢 🎉`. The Office Day must match both
  the visible and hidden channel IDs, and the verified Portal sender must equal
  the actor.
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

Reaction state is last-write-wins per message, emoji, and actor using canonical
event time with the event key as a deterministic tie-breaker. This makes replay
order irrelevant while preserving ownership: a New Hire's event can change
only that New Hire's participation. Clients fold an event only when its target
is a runtime-valid visible message in the named Office Channel for the same
Office Day. Missing, malformed, removed-from-view, and cross-channel targets do
not affect the rendered projection. The message UI exposes the fixed palette as
native controls with named choices, focus restoration, Escape handling, and
44-pixel touch targets.

For profile changes, the reserved `office-events:profiles` sender publishes the
committed outbox event to the current Office Day event channel. Connected
clients invalidate only cached batches containing that `profileId`, so live and
historical attribution, profile pictures, detailed presence, and profile UI all
read the same canonical Neon result. Duplicate, delayed, and reordered signals
can only trigger another read and therefore cannot restore old values. Active
queries also repair every 30 seconds and on focus or reconnect, covering a
missed signal. A failed publish leaves the outbox row pending; Clerk retries and
later authenticated session or Portal-token requests safely retry the same
deterministic event key.

The subscriber advances the event channel read position, durably mutes its
Portal inbox entry, and clears that entry's independent inbox watermark. Product
channel lists also exclude the event channel, so Office Events do not render as
messages, appear as visible channels, or contribute to user-facing attention.
Guarded mock mode persists the same event envelopes in its in-memory Portal
adapter and exposes them through an authenticated test-only route; production
and live mode continue to publish and replay directly through Portal.

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
  current profile writes only after Clerk signature verification, applies
  source-version ordering in Neon, and drains committed profile invalidations
  through the reserved Portal sender.
- `/api/cron/office-days` is the Vercel Cron boundary. It requires the exact
  server-only `CRON_SECRET`, transactionally ensures the daily plan in Neon,
  and drains due scripted System Events through labeled Office Character
  senders.
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
  Clerk payload validation, drift repair, the transactional profile outbox,
  and the TanStack Query batch-read contract.
- `src/lib/office-events/` owns the versioned Office Event runtime contract,
  reserved-sender checks, reaction projection, replay deduplication, and the
  narrow browser subscription that isolates event-channel inbox attention.
- `src/lib/office-days/` owns fixed Office Character identities and scripts,
  deterministic daily planning, retry-state publishing, Cron authorization,
  and client event-key deduplication.
- `src/lib/hr-reports/` owns approved categories, stable-reference validation,
  open-report idempotency, safe review links, one-way dismissal, private audit
  records, canonical review-query caching, and notification outbox draining.
- `src/lib/employment/` owns UTC Send Home policy, required private-reason
  validation, idempotent employment actions, effect-outbox draining, and the
  privacy-safe public System Event contract.
- `/api/office/onboarding` authenticates every mutation, updates Clerk before a
  profile projection, and rejects Clock In until required onboarding state is
  durable.
- `/api/office/employee-record` authenticates every read and mutation. Writes
  update Clerk before confirming onboarding or inspecting Neon; reads repair
  and report projection convergence without treating Neon as profile authority.
- `/api/office/hr-reports` authenticates completed New Hires, rejects unknown
  type-specific categories, non-current Office Channels, and unavailable New
  Hire Profiles, and never accepts message text or mutable profile values.
- `/api/office/operator/hr-reports` rechecks authenticated Clerk identity and
  the complete environment allowlist for every read and dismissal. It returns
  private review state only to Operators and atomically records each dismissal
  once with its optional private note.
- `/api/office/operator/send-home` rechecks Operator access, requires a private
  reason and retry-stable request ID, records the expiring action and relevant
  report transition transactionally, and drains the controlled Portal effects.
- `/api/office/employment` returns only the authenticated New Hire's canonical
  access decision so an invalidation can move an active client to a truthful
  access-ended state without exposing the private audit.
- `/api/office/portal/token` authenticates the New Hire, checks completed
  onboarding and employment eligibility before Portal membership work,
  idempotently grants all five daily Office Channel memberships and the hidden
  Office Event membership, and mints a 15-minute Portal user token scoped to all
  six. It never returns the Portal secret.
- `/api/office/portal/mock-chat` is a guarded non-production adapter route used
  only by the credential-free UI and browser tests. Live chat goes directly
  through the published Portal SDK and hosted APIs.
- `/api/office/portal/mock-inbox` is the guarded deterministic inbox seam. It
  exposes only server-owned mock conversation rows and advances their mock
  watermark on visible-read; live inbox state comes directly from Portal's
  published React hook.
- Browser-facing configuration uses only publishable `NEXT_PUBLIC_*` keys.
  Secret values remain server-only.
