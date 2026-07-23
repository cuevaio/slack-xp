# Portal Messenger: Corporate Edition

Portal Messenger is a forkable Next.js example for building a communal realtime
office with hosted Portal APIs. The application is intentionally safe to run
before Clerk, Portal, or Neon credentials are available.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcuevaio%2Fslack-xp&project-name=portal-messenger&repository-name=portal-messenger&env=APP_ENV,APP_ORIGIN,NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,CLERK_SECRET_KEY,CLERK_WEBHOOK_SECRET,NEXT_PUBLIC_PORTAL_KEY,PORTAL_SECRET,DATABASE_URL,CRON_SECRET&envDefaults=%7B%22APP_ENV%22%3A%22production%22%7D&envDescription=Clerk%2C%20Portal%2C%20and%20Neon%20are%20required.%20Use%20separate%20production%20resources.&envLink=https%3A%2F%2Fgithub.com%2Fcuevaio%2Fslack-xp%2Fblob%2Fmain%2Fdocs%2Fdeployment.md)

> **Public deployment warning:** this is a deploy-ready Portal customer example,
> not a production-complete workplace platform. Anyone you allow to sign in can
> publish into the Shared Public Office. Read
> [Privacy and limitations](docs/privacy-and-limitations.md) before making a
> deployment public.

## The experience

- An **Observer** sees a designed, read-only preview of current Office Channel
  history. The browser polls a narrow Portal Messenger endpoint and never
  receives a Portal credential, presence state, or publishing capability.
- A signed-in **New Hire** completes the New Employee Setup Wizard, then joins
  five curated Office Channels for the current UTC Office Day with persistent
  messages, history, presence, typing, unreads, reactions, and System Events.
- An **Operator** is a trusted New Hire whose Clerk user ID appears in a
  server-only allowlist. Operators review private HR Reports, render messages as
  Removed Message tombstones, Send Home or Terminate New Hires, and reverse
  Terminations inside the messenger.

The example is an ordinary customer of hosted Portal APIs and published
`@portalsdk/*` packages. It does not import, vendor, run, or modify private
Portal code, and no private repository link or local realtime infrastructure is
a prerequisite.

## Release guide

| Need | Document |
| --- | --- |
| Fork, configure, and deploy | [Ordered deployment guide](docs/deployment.md) |
| Variables and Vercel scopes | [Environment reference](docs/environment.md) |
| Service authority and data flow | [Architecture](docs/architecture.md) |
| Versioned custom realtime events | [Office Event protocol](docs/office-event-protocol.md) |
| Operate and troubleshoot | [Operations guide](docs/operations.md) |
| Privacy, retention, and product boundaries | [Privacy and limitations](docs/privacy-and-limitations.md) |
| Contribute | [Contributing guide](CONTRIBUTING.md) |
| Protected end-to-end verification | [Manual real-service smoke](docs/real-service-smoke.md) |

Prerequisites are a GitHub account, Bun `1.3.13`, and accounts for Clerk,
Portal, Neon, and Vercel. Clerk authentication, Portal realtime services, and
Neon persistence are required in local, preview, test, and production
environments. Use separate development and production resources; follow the
ordered guide rather than reusing credentials across scopes.

At a glance: fork the repository and select one Vercel Function region; create
and verify a development Clerk, Portal, Neon, and Vercel stack; create a separate
production stack; apply committed Neon migrations and Portal customer policy;
configure Clerk lifecycle webhooks and exact origins; deploy; then require a
passing production setup check before announcing the office. The deploy button
creates the production Vercel project, but it does not replace those provider
and verification steps.

## Quick Start

The project uses Bun exclusively.

```bash
bun install
cp .env.example .env.local
bun run dev
```

Before starting the app, replace every placeholder in `.env.local`, run
`bun run db:migrate`, `bun run portal:deploy`, and `bun run setup:check` against
your development Clerk, Portal, and Neon resources. Open
[http://localhost:3000](http://localhost:3000) for the Observer experience;
entering [http://localhost:3000/office](http://localhost:3000/office) uses Clerk
sign-in and the configured Portal and Neon services.

## Runtime Configuration

`APP_ENV` explicitly selects `local`, `test`, `preview`, or `production`.
Vercel's `VERCEL_ENV` selects preview or production when `APP_ENV` is absent.
There is no service-mode selector: every environment requires Clerk, Portal,
and Neon configuration.

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
any malformed entry makes the entire allowlist grant no Operator access.

`PORTAL_MESSENGER_MAINTENANCE` is an optional server-only fail-closed control.
It defaults to `off`; set it to `on` and redeploy to pause the Shared Public
Office. Authenticated office API requests, including Portal token issuance and
refresh, then return a private `503 maintenance_active` response, while
`/office` renders a maintenance state without constructing Portal or Neon
adapters. Connected application clients recheck the server control every five
seconds and unmount Portal immediately when activation is observed. This is a
server access boundary, not CSS hiding. A Portal token issued before activation
retains its externally enforced 15-minute lifetime, so incident response for a
compromised direct Portal client must also use Portal access controls.

Only `off` and `on` are valid values. Any other configured value fails closed
as Installation Incomplete and is also treated as active by the request gate.
After maintenance is disabled, conversation content returns only after fresh,
successful Neon profile and Removed Message projection reads.

Use one development Clerk, Portal, and Neon stack for local work and a dedicated
development Vercel project. Use a separate production Vercel project and set the
same variable names to a separate production service stack in its Production
environment; production setup verification requires Clerk live keys.
`APP_ORIGIN` is the exact `http://` or `https://` browser origin registered with
Clerk and Portal, with no path or trailing slash.

The repository selects one Vercel Function region in `vercel.json`. Change the
single `regions` entry to the region nearest the production Neon database. This
is deployment configuration, not an environment secret.

Configuration is validated before service adapters are created. Invalid or
partial configuration renders Installation Incomplete and lists only variable
names and reasons. Values are never returned to that screen. The Observer page
does not receive a Portal credential; its public history endpoint retains the
credential server-side and returns only safety-projected message fields. Office
entry links disable route prefetching, so the authenticated office boundary is
not rendered until an Observer explicitly chooses to enter it.

Missing or invalid service credentials fail closed with the Installation
Incomplete screen. The application never substitutes local authentication,
conversation data, or persistence when a required service is unavailable.

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

The Removed Message migration adds `message_removals` and
`message_removal_invalidation_outbox`, extends Operator audits for the
`removed` action, and lets matching open message HR Reports resolve as
`removed`. Each projection retains only its stable Office Day, Office Channel,
and Portal message IDs plus the acting Operator and timestamps. The required
private reason is stored only in `operator_actions`; no Portal message body is
copied. Projection insertion, matching report resolution, one uniquely
constrained audit, and one pending invalidation row commit in one Neon HTTP
transaction, so retrying or racing the mutation returns the first projection.

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

The Termination migration keeps persistent employment state separate in
`employment_terminations`, links each reversal through
`employment_reinstatements`, and delivers controlled effects through
`employment_termination_effect_outbox`. A partial unique index permits only one
active Termination per New Hire, while unique request and original-Termination
references make concurrent forward and reversal requests converge without
duplicate Operator audits. Required reasons remain only in `operator_actions`;
public records and outbox rows contain stable IDs and timestamps.

Termination applies non-expiring Portal bans to every current visible and
hidden Office Channel, which closes active connections. Neon remains canonical
across future Office Days: page entry, membership repair, and token minting are
denied before Portal calls. Reinstatement records its own Operator, reason, and
timestamp plus its original Termination ID. It removes the persistent current-
day bans through Portal's published channel-ban endpoint, but first refetches
Neon state: an active Send Home is reapplied with its UTC expiry, and account
deletion or a newer active Termination prevents unbanning. Both actions publish
all-hands System Events containing only Operator, target, action, and stable
Termination reference, followed by `employment.invalidated` hints that clients
use only to refetch Neon.

In the Clerk Dashboard, create a webhook endpoint for
`https://<deployment>/api/webhooks/clerk`, subscribe it to `user.created`,
`user.updated`, and `user.deleted`, and put that endpoint's signing secret in
`CLERK_WEBHOOK_SECRET`. The Node.js route verifies the signature before parsing
profile fields and returns a generic `400` for invalid signatures or payloads;
it does not log secrets or profile data. Clerk's current name and picture are
also projected when an authenticated session is established. That repair uses
the same source-version rule as webhooks, so a stale session read cannot roll a
newer projection backward.

A verified `user.deleted` event writes a source-ordered tombstone in the same
profile row, clearing first name, last name, display name, and picture. Its
stable-reference-only profile invalidation refreshes live and historical
attribution before the existing persistent Portal ban mechanism disconnects
current channels. Page entry, onboarding, Employee Record access, membership
repair, reconnect, and token minting all consult the same canonical `deleted`
employment decision used by the composed access controls. Replays safely reuse
the outbox event and bans; delayed updates and authenticated session repair
cannot restore a tombstone. Only a newer verified `user.created` Clerk lifecycle
event may restore the projection. Account deletion creates no Operator action,
private audit, Termination, public employment System Event, or reinstatement
control.

Authenticated server consumers batch attribution through
`POST /api/office/profiles` with `{ "clerkUserIds": [...] }`. A request accepts
at most 100 supplied stable Clerk user IDs, deduplicates them, and performs one
Neon query. Results contain only the stable ID, current display name and
picture, and a status. A tombstone returns `Former Employee` with no picture and
the `former` status. A
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

## Portal Office Channels and Office Events

Portal is the sole authority for live conversation messages and history. Neon
does not store or duplicate message bodies. Each UTC Office Day has exactly five
visible Office Channels:

| ID | Name | Purpose | Portal mode |
| --- | --- | --- | --- |
| `general:v2:{YYYY-MM-DD}` | General | Company-wide conversation | standard |
| `watercooler:v2:{YYYY-MM-DD}` | Watercooler | Casual conversation and breakroom chatter | standard |
| `tech-support:v2:{YYYY-MM-DD}` | Technical Support | Comedic technical support for suspicious office technology | standard |
| `urgent:v2:{YYYY-MM-DD}` | Urgent | Urgent workplace chatter | standard |
| `all-hands:v2:{YYYY-MM-DD}` | All Hands | System Events and company-wide announcements | broadcast |

Office Days before the 2026-07-23 authorization-policy rollout use the legacy
`{slug}:{YYYY-MM-DD}` format. IDs deliberately omit branch, deployment, tenant,
user, and internal alias namespaces.

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
authority. The application has no polling or local fallback for Portal unread
state.

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
reports plus open, dismissed, and removal-resolved state, and its context links
use the same stable message coordinates or current New Hire Profile lookup as
notifications.
`PATCH /api/office/operator/hr-reports` accepts only a stable report ID and an
optional private note, then performs the validated one-way dismissal. Both
methods authenticate the current Clerk session, require completed onboarding,
and re-evaluate `OPERATOR_CLERK_USER_IDS`; UI visibility and client claims are
never authorization boundaries. The queue and Operator status have separate
TanStack Query caches with periodic repair. Trusted `report.invalidated` and
`operator.invalidated` Office Events narrowly invalidate those caches and never
carry canonical state or private notes.

Confirmed messages also expose an Operator-only **Remove message** action.
`POST /api/office/operator/message-removals` requires a completed,
authenticated Operator, rechecks `OPERATOR_CLERK_USER_IDS`, accepts only a
current curated Office Channel ID, stable message ID, and required private
reason, and never accepts message text. `GET /api/office/message-removals`
returns body-free canonical projections to authenticated New Hires. Every live,
recent-history, and paginated occurrence is composed with those projections and
rendered in place as an accessible **Removed Message** tombstone retaining its
original order and timestamp. If the removal query fails, raw Portal history is
hidden until Neon returns, as required by the fail-closed safety boundary.

This is application-level removal only. It does not retract or hard-delete the
message in Portal storage. A valid client authorized to access Portal directly
may still retrieve the original payload; normal Portal Messenger rendering is
the protected surface. The private reason is visible only in the Operator audit
and is never placed in the tombstone, public projection response, logs, or
Office Event.

Application-owned retention selection keeps HR Reports, Operator audits, and
reversed Terminations for 90 days. Office Days, completed outbox work, and
Removed Message projections are selected after 30 days. Pending outbox work and
active Terminations are never selected; an active Termination remains durable
until reinstatement, after which its 90-day period starts at the reversal.

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
The application never substitutes browser-local messages.

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

Invalidations never carry names, report details, removal state or private
reason, employment state, or Operator state. Consumers refetch the corresponding
Neon-owned query; only reaction events are folded as canonical Portal-owned
state. The typed
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
All environments publish and replay these envelopes directly through Portal.

## Clerk Authentication

Clerk's hosted Account Portal owns sign-in. Configure the desired
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

## Checks

The canonical deployment also has a maintainer-only, dispatch-only real-service
workflow. Its protected environment, required variables and secrets, gated
disposable Clerk lifecycle, redaction guarantees, and cleanup behavior are
documented in [docs/real-service-smoke.md](docs/real-service-smoke.md). It is not
part of ordinary pull-request or push CI.

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
one small ephemeral message to the current General Office Channel. It
proves reconnect history against one reusable synthetic `general:*` channel and
marker, so repeated checks do not create visible messages, unread state, or
unbounded verification channels. The command never prints message bodies, IDs,
credentials, connection strings, profile data, or upstream response bodies.

Exit codes are stable: `0` means every required check passed, `1` means a check
failed (or production proof is incomplete), and `2` means non-production proof
was unavailable because a configured service could not be reached. Corrective
output contains variable names and categories only. Clerk's
API proves that the key pair works and belongs to the expected development or
production stack; confirm in the Clerk Dashboard that the endpoint
`<APP_ORIGIN>/api/webhooks/clerk` subscribes to `user.created` and
`user.updated`, and `user.deleted`, because subscription details are not exposed
by the credential check.

After `bun run setup:check` reports migration drift, apply only the committed
Drizzle migrations and check again:

```bash
bun run db:migrate
bun run setup:check
```

Neither setup check executes migrations. Migrations remain absent from build,
development startup, and application startup.

## Repository Verification

Static and isolated domain checks run without external credentials. Running the
application and end-to-end verification requires the configured development
Clerk, Portal, and Neon stack:

```bash
bun run lint
bunx tsc --noEmit
bun run build
bun run test:unit
bun run test:server
bun run docs:check
bun run deploy:dry-run
```

## Architecture Boundaries

- `/` is the Observer experience. It polls a public, read-only application
  endpoint for current-day Office Channel history; the server retains Portal
  credentials and applies Neon Removed Message projections before returning a
  narrow public shape.
- `/api/observer/portal/history` accepts only curated channel slugs and returns
  no Portal token, sender ID, profile value, or removed message body.
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
- `src/lib/auth/` owns Clerk verification and exact Operator
  allowlist matching. Server-derived identity is passed into office rendering.
- `src/lib/config.ts` owns environment classification and validation.
- `src/lib/safety/` owns the maintenance gate, dependency timeouts, projection
  freshness policy, correlation IDs, and privacy-safe structured failure logs.
- `src/lib/adapters/` owns Portal-shaped and Neon-shaped boundaries. It cannot
  determine or override the authenticated identity.
- `src/lib/db/` contains the Drizzle schema and Neon HTTP client boundary.
  `src/lib/onboarding/` owns deterministic assignment, onboarding state, and
  Neon persistence. `src/lib/profiles/` owns
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
- `src/lib/message-removals/` owns stable-reference validation, body-free
  canonical queries, retry-safe removal and outbox draining, and the TanStack
  Query invalidation contract used to compose Portal history.
- `src/lib/employment/` owns UTC Send Home policy, persistent Termination and
  linked reinstatement policy, required private-reason validation, idempotent
  employment actions, effect-outbox draining, and privacy-safe public System
  Event contracts.
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
- `/api/office/message-removals` returns only body-free projections for one
  current Office Channel. `/api/office/operator/message-removals` rechecks the
  Operator allowlist before atomically creating a projection, resolving matching
  open HR Reports, auditing the required private reason, and queuing a reserved-
  sender invalidation.
- `/api/office/safety-state` exposes only the authenticated runtime maintenance
  decision. It is never a conversation-data fallback.
- `/api/office/operator/send-home` rechecks Operator access, requires a private
  reason and retry-stable request ID, records the expiring action and relevant
  report transition transactionally, and drains the controlled Portal effects.
- `/api/office/operator/termination` rechecks Operator access for canonical
  target-state reads, Termination, and reinstatement. Mutations require a stable
  request ID and private reason; Termination may resolve a matching open HR
  Report, while reinstatement is available from the New Hire Profile and links
  back to the original action.
- `/api/office/employment` returns only the authenticated New Hire's canonical
  access decision so an invalidation can move an active client to a truthful
  access-ended state without exposing the private audit.
- `/api/office/portal/token` authenticates the New Hire, checks completed
  onboarding and employment eligibility before Portal membership work,
  idempotently grants all five daily Office Channel memberships and the hidden
  Office Event membership, and mints a 15-minute Portal user token scoped to all
  six. It never returns the Portal secret.
- Browser-facing configuration uses only publishable `NEXT_PUBLIC_*` keys.
  Secret values remain server-only.

## Safety-state failure behavior

Portal history is not rendered until both required Neon projections compose
successfully: every requested stable Clerk ID must have a current or anonymous
profile attribution, and every Removed Message projection must belong to the
requested Office Channel. Reads time out after five seconds, reject malformed,
incomplete, duplicated, or cross-channel responses, and become unacceptable
after 45 seconds without a successful repair. Invalidation signals clear the
affected cached safety state before refetching, preventing old message bodies or
profile attributes from flashing during recovery.

Neon safety failures show “Message safety checks are unavailable” and disable
publishing; raw Portal history is never used as a fallback. Portal failures show
a separate offline state and never start a local or fake live-data substitute.
Clerk remains the authentication authority and an authentication failure cannot
enter the office. Recovery always refetches Neon projections before content is
shown again.

Safety-boundary logs are one-line JSON with `operation`, `correlationId`,
`authority`, and status plus allowlisted stable identifiers such as an Office
Channel ID. They never serialize request bodies, message bodies, HR Report
details, private reasons, profile attributes, tokens, secrets, or thrown error
messages.

## License

Portal Messenger is available under the [MIT License](LICENSE). Analytics are
not installed or enabled by default.
