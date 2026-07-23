# Portal Messenger: Corporate Edition

A forkable Next.js example that turns a fictional 2001 office into a communal,
realtime chat. It showcases how to build authenticated messaging with
[Portal](https://useportal.co), while Clerk handles identity and Neon stores the
small amount of application-owned data.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcuevaio%2Fslack-xp&project-name=portal-messenger&repository-name=portal-messenger&env=APP_ENV,APP_ORIGIN,NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,CLERK_SECRET_KEY,CLERK_WEBHOOK_SECRET,NEXT_PUBLIC_PORTAL_KEY,PORTAL_SECRET,DATABASE_URL,CRON_SECRET&envDefaults=%7B%22APP_ENV%22%3A%22production%22%7D&envDescription=Add%20your%20Portal%2C%20Clerk%2C%20and%20Neon%20credentials.%20See%20the%20deployment%20guide%20for%20setup%20details.&envLink=https%3A%2F%2Fgithub.com%2Fcuevaio%2Fslack-xp%2Fblob%2Fmain%2Fdocs%2Fdeployment.md)

> This is a public demo, not a production-complete workplace platform. Anyone
> you allow to sign in can participate in the Shared Public Office. Review
> [privacy and limitations](docs/privacy-and-limitations.md) before publishing
> your deployment.

## What It Demonstrates

- Persistent Portal channels with history and pagination
- Realtime messages, presence, typing indicators, and unread counts
- Optimistic sending, reconnect handling, and short-lived user tokens
- Standard and broadcast channel modes
- Portal publish middleware for server-side message moderation
- Portal events that invalidate application state without duplicating it
- Authenticated channel membership and operator actions
- A read-only Observer experience that never exposes Portal credentials

Portal owns messages, history, presence, typing, and unread state. Neon stores
profiles, onboarding, reports, and safety projections, but never copies message
bodies. This separation keeps each system authoritative for the data it is best
suited to manage. See [Architecture](docs/architecture.md) for the complete data
flow.

## Quick Start

You need [Bun](https://bun.sh), a Portal environment, a Clerk application, and
a Neon Postgres database.

```bash
bun install
cp .env.example .env.local
# Fill in .env.local, then prepare the backing services:
bun run db:migrate
bun run portal:deploy
bun run setup:check
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) for the read-only Observer
view or [http://localhost:3000/office](http://localhost:3000/office) to sign in
and join the office.

`bun run portal:deploy` publishes the channel templates and moderation
middleware in [`portal.config.ts`](portal.config.ts). The application creates
the current day's channels through Portal as they are used.

## Deploy To Vercel

1. Create production environments in Portal, Clerk, and Neon.
2. Click **Deploy with Vercel** above and enter the required variables.
3. Apply the database migrations with `bun run db:migrate` using the production
   `DATABASE_URL`.
4. Deploy the Portal configuration with `bun run portal:deploy` using the
   production `PORTAL_SECRET`.
5. In Clerk, add `https://<your-domain>/api/webhooks/clerk` as a webhook for
   `user.created`, `user.updated`, and `user.deleted`. Put its signing secret in
   `CLERK_WEBHOOK_SECRET`, then redeploy.

The button creates and deploys the Vercel project. Migrations, Portal policy,
and the Clerk webhook are explicit post-deploy steps because they modify
external services. For separate development and production stacks, region
selection, and release checks, follow the [deployment guide](docs/deployment.md).

## Environment Variables

Only the two `NEXT_PUBLIC_*` values are exposed to the browser. Keep every
other value server-only.

| Variable | Required | Description |
| --- | --- | --- |
| `APP_ENV` | Recommended | `local`, `test`, `preview`, or `production`. Vercel falls back to `VERCEL_ENV` when omitted. |
| `APP_ORIGIN` | Yes | Exact app origin, such as `http://localhost:3000`, with no path or trailing slash. Register it with Clerk and Portal. Production must use HTTPS. |
| `NEXT_PUBLIC_PORTAL_KEY` | Yes | Portal publishable key (`pk_...`). |
| `PORTAL_SECRET` | Yes | Server-only Portal secret (`sk_...`) used for policy, membership, tokens, and publishing. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key. Use `pk_test_...` outside production and `pk_live_...` in production. |
| `CLERK_SECRET_KEY` | Yes | Matching server-only Clerk key (`sk_test_...` or `sk_live_...`). |
| `CLERK_WEBHOOK_SECRET` | Yes | Signing secret (`whsec_...`) for `/api/webhooks/clerk`. |
| `DATABASE_URL` | Yes | Pooled Neon Postgres connection string. |
| `CRON_SECRET` | Yes | Random value of at least 16 characters used to authorize the daily Office Day cron. |
| `OPERATOR_CLERK_USER_IDS` | No | Comma- or whitespace-separated Clerk user IDs that receive Operator access. |
| `PORTAL_MESSENGER_MAINTENANCE` | No | `off` by default. Set to `on` and redeploy to pause authenticated office access. |

Start from [`.env.example`](.env.example). Use separate Portal, Clerk, and Neon
resources for development and production. The full scoping and security notes
are in the [environment reference](docs/environment.md).

## Portal Concepts In The Example

Five daily Office Channels demonstrate different realtime behaviors:

| Channel | Portal mode | Purpose |
| --- | --- | --- |
| General | Standard | Company-wide conversation |
| Watercooler | Standard | Casual conversation |
| Technical Support | Standard | Workplace tech support |
| Urgent | Standard | Urgent workplace chatter |
| All Hands | Broadcast | System events and announcements |

Authenticated entry upserts membership in those channels, then mints a
short-lived Portal user token. The browser uses `@portalsdk/react` for live
conversation state and requests a fresh token from the server when needed. A
hidden Portal channel carries versioned Office Events, allowing clients to
refetch canonical Neon state without putting private data into realtime events.

Useful files:

- [`portal.config.ts`](portal.config.ts): channel templates and publish middleware
- [`src/lib/portal`](src/lib/portal): Portal client and server integration
- [`src/components/portal-chat.tsx`](src/components/portal-chat.tsx): realtime chat UI
- [`docs/office-event-protocol.md`](docs/office-event-protocol.md): custom event contract
- [`docs/operations.md`](docs/operations.md): troubleshooting and operations

## Verify

```bash
bun run lint
bunx tsc --noEmit
bun run build
```

For contribution conventions, see [CONTRIBUTING.md](CONTRIBUTING.md).
