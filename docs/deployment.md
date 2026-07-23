# Fork and deploy

This is the complete ordered release path for an ordinary Portal customer.
Nothing in it requires Portal's private repository or a local realtime stack.
Running or deploying the application does require Clerk, Portal, and Neon.

Run the documentation and packaging rehearsal at any time. This does not run
the application or replace required service verification:

```bash
bun install --frozen-lockfile
bun run deploy:dry-run
```

The rehearsal validates local documentation links, the Deploy button, required
environment names, Vercel and Portal configuration, exact Portal package
versions, and the Bun lockfile policy. It reads no service credential, makes no
network call, and changes no provider state.

## Resource plan

Create two fully separate stacks:

| Resource | Development stack | Production stack |
| --- | --- | --- |
| Clerk | Development application with test keys | Production application with live keys |
| Portal | Development customer environment | Production customer environment |
| Neon | Development database | Production database |
| Vercel | Development project using `APP_ENV=preview` | Production project using `APP_ENV=production` |

The Vercel Deploy button in [README.md](../README.md) clones the public
repository and creates the production project. If you already forked on GitHub,
import that fork into Vercel instead. In either case, create a second Vercel
project from the same fork for development and keep its values isolated from
production.

## 1. Fork and select a region

Fork the repository and keep `bun.lock`; do not create another lockfile. In
`vercel.json`, replace the single `regions` value only if another supported
Vercel region is closer to the production Neon primary. Keep one region and the
checked-in midnight UTC Cron:

```json
{
  "regions": ["iad1"],
  "crons": [{ "path": "/api/cron/office-days", "schedule": "0 0 * * *" }]
}
```

This is the only region decision required by the application.

## 2. Build the development stack

1. Create a Clerk development application. Enable the social connections or
   email verification-code strategy you want; do not add a parallel account,
   organization, password, or invitation model.
2. Create a Portal development environment and copy its publishable and secret
   customer keys. Register `http://localhost:3000` and the exact HTTPS origin
   of the development Vercel project as allowed origins.
3. Create a Neon development database in the selected geographic region and
   copy its pooled connection string.
4. Create the development Vercel project from your fork. Set `APP_ENV=preview`,
   the exact project origin, and only development service
   values from [Environment reference](environment.md).
5. Generate a distinct `CRON_SECRET` of at least 16 characters. Add desired
   development Operator Clerk IDs to `OPERATOR_CLERK_USER_IDS`.

For local work, copy `.env.example` to `.env.local` and substitute the
development values. Clerk, Portal, and Neon are required locally; the
application has no credential-free service mode.

## 3. Prepare and verify development

Select the development credentials, then apply state explicitly:

```bash
bun run db:migrate
bun run portal:deploy
bun run setup:check
```

`bun run db:migrate` applies only committed Drizzle migrations. Migrations never
run during install, build, application startup, or request handling.

`bun run portal:deploy` publishes `portal.config.ts` to the Portal environment
selected by `PORTAL_SECRET`. It configures all visible channels, the hidden
Office Event channel, and the Operator notification channel with
`anonymous: false`; All Hands uses broadcast mode. It adds no content
middleware. Broadcast presentation is not a publish-authorization boundary.
Every Office Day uses the permanent `v3` channel namespace. Access control
grants only the five visible `v3` channels and the hidden `v3` Office Event
channel for that day; legacy and `v2` IDs are not accepted.

Portal v1 does not expose supported channel or message deletion operations.
Channels are implicit resources created through use, so do not infer a reset
endpoint or delete dashboard archive records. Switching to the unused `v3`
namespace provides the clean conversation start. Run `bun run portal:deploy`
before entering the app so only the current policy is published. The fixed
`hr-reports` Operator notification channel remains separate from Office Day
conversation history.

In the Clerk development dashboard, create
`https://<development-origin>/api/webhooks/clerk`, subscribe to `user.created`,
`user.updated`, and `user.deleted`, and store that endpoint's signing secret as
`CLERK_WEBHOOK_SECRET` in the development Vercel project. Deploy again after
adding or changing environment values.

Run `bun run setup:check` with development values. Exit `0` proves Neon
connectivity and migrations, the Clerk key environment, Portal anonymous
refusal, authenticated membership and publishing, standard channel mode,
allowed and unregistered origin policy, and persistent reconnect history. Exit
`2` means non-production live proof was unavailable; exit `1` means a required
check failed.

## 4. Build the production stack

Repeat the provider setup with new resources, not copied development
credentials:

1. Create the Clerk production application and configure its chosen sign-in
   connections.
2. Create the Portal production environment. Register only the exact production
   HTTPS origin and other intentionally supported origins.
3. Create the Neon production database near the committed Vercel Function
   region.
4. Create or finish the separate production Vercel project. Set
   `APP_ENV=production`, the exact final `APP_ORIGIN`, and
   production-only values. Generate a new production `CRON_SECRET` and list
   production Operator Clerk IDs.

If the Vercel-created domain differs from the origin entered through the Deploy
button, update `APP_ORIGIN`, the Clerk application URLs, and Portal's allowed
origins to the exact assigned or custom domain before launch. A partial first
deployment is safe: it shows Installation Incomplete and does not initialize
live office adapters.

## 5. Apply production configuration in order

Pull the production project's values into an ignored local file or export the
same values from a secure secret manager. With those production values selected,
run:

```bash
bun run db:migrate
bun run portal:deploy
```

Confirm the Portal command targeted the production customer environment. Then
create the production Clerk webhook at
`https://<production-origin>/api/webhooks/clerk` with all three lifecycle
events, store its unique signing secret in Production scope, and redeploy the
production Vercel project. Do not run migrations as a Vercel build command.

Vercel reads `vercel.json` and installs with the committed Bun lockfile. The
Office Day Cron calls `/api/cron/office-days` at midnight UTC and Vercel supplies
the configured `CRON_SECRET` bearer authorization.

## 6. Verify production before announcing it

Run the checker with the exact production environment:

```bash
bun run setup:check
```

Production requires Clerk live keys and treats unavailable proof as failure.
Then verify manually:

1. `/` renders the read-only Observer preview while signed out, refreshes
   current Office Channel messages within several seconds, and exposes no
   Portal credential or publishing control.
2. `/office` refuses signed-out access and completes Clerk sign-in.
3. A New Hire can finish onboarding, publish, reload history, see presence and
   typing, switch channels, and reconnect.
4. A configured Operator can receive and privately review an HR Report.
5. The Clerk webhook updates a profile and a deleted disposable development
   identity becomes Former Employee. Do not delete a real production identity
   merely to test this.
6. The Cron route reports success without exposing its bearer secret.
7. The production setup check passes against Clerk, Portal, and Neon.

Canonical maintainers can additionally run the protected
[Manual real-service smoke](real-service-smoke.md). Fork owners do not need that
workflow to deploy.

## 7. Operate

Keep provider billing, quotas, origin lists, Operator membership, webhook
delivery, migration state, and outbox health under review. Use
`PORTAL_MESSENGER_MAINTENANCE=on` and redeploy when safety projections cannot be
trusted, then follow [Operations](operations.md). Read
[Privacy and limitations](privacy-and-limitations.md) before opening sign-in to
the public.
