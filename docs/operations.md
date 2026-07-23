# Operations and troubleshooting

Start with:

```bash
bun run setup:check
```

The checker prints only check names, status, and corrective categories. It does
not print credentials, connection strings, profile data, message content, or
upstream response bodies.

## Troubleshooting

| Symptom | Likely cause | Safe action |
| --- | --- | --- |
| **Installation Incomplete** | A required live variable is missing or invalid, production selected mock mode, or maintenance has an invalid value. | Compare variable names with [Environment reference](environment.md). Correct the Vercel scope and redeploy. Values are intentionally absent from the screen. |
| Signed-out or anonymous access is refused | Expected behavior: Clerk authentication and Portal `anonymous: false` are both required boundaries. | Sign in through Clerk. Never enable Portal anonymous access to bypass an application problem. |
| Allowed deployment cannot connect, or an unexpected origin connects | `APP_ORIGIN` and Portal/Clerk origin lists disagree, include a path/trailing slash, or contain a preview origin unintentionally. | Register the exact scheme and host, redeploy `portal.config.ts`, and rerun setup verification. Remove untrusted preview origins. |
| Portal disconnects near 15 minutes | Portal user-token refresh failed, Clerk authentication expired, employment access changed, or safety maintenance activated. | Check the authenticated token route and Clerk session. The SDK callback must request a fresh server-minted token; never place `PORTAL_SECRET` in the browser. |
| **Migration drift** | The selected Neon database lacks a committed Drizzle migration. | Confirm `DATABASE_URL`, run `bun run db:migrate` explicitly, then rerun `bun run setup:check`. Do not add migration execution to build or startup. |
| A current profile becomes stale after a webhook | Clerk delivery is delayed, events arrived out of order, or the wrong endpoint secret is scoped. | Confirm signature secret and subscriptions for `user.created`, `user.updated`, and `user.deleted`. Session repair and source versions prevent an older event from winning; do not edit Neon by hand. |
| Portal is offline | Portal keys/environment mismatch, customer policy was not deployed, origin policy rejects the browser, or the hosted service is unavailable. | Run `bun run portal:deploy` against the intended environment and `bun run setup:check`. Live mode must stay offline rather than substituting mock data. |
| Message safety checks are unavailable | Neon profile or Removed Message projections timed out, were malformed, or became stale. | Check Neon and application logs by correlation ID. Keep content hidden until fresh canonical projections succeed; never render raw Portal history as a fallback. |
| Maintenance screen persists | `PORTAL_MESSENGER_MAINTENANCE` is `on`, invalid, or the deployment has not picked up the corrected value. | Set exactly `off`, redeploy, and wait for fresh Neon safety reads. Also use Portal controls if already issued tokens must be contained before their 15-minute expiry. |
| Production build or startup rejects mock mode | `SERVICE_MODE=mock` is explicitly configured in Production. | Replace it with `live` and configure the complete production stack. Never suppress this rejection. |
| HR Report notification is delayed | The Neon transaction committed but targeted Portal delivery remains pending. | Restore Portal, then trigger a safe outbox drain through a later report submission or Portal-token refresh. Do not copy private report data into a public message. |
| A Removed Message is retrievable through a direct Portal client | Expected limitation: removal is an application projection, not Portal erasure. | Restrict Portal access and follow the retention/privacy policy. Do not claim the source payload was deleted. |

## Maintenance and incident response

Set `PORTAL_MESSENGER_MAINTENANCE=on` in the affected Vercel project and
redeploy. New office API requests, Portal token issuance and refresh, active
conversation rendering, and publishing stop fail-closed. The Observer remains a
non-live preview.

Portal enforces the lifetime of an already issued token, so use Portal customer
access controls when immediate direct-client containment is required. Restore
Neon and Portal, confirm Clerk authentication, set maintenance exactly to
`off`, redeploy, and require fresh safety projections before reopening.

## Logs and monitoring

Safety logs are one-line structured JSON containing operation, correlation ID,
authority, status, and allowlisted stable identifiers. They exclude request and
response bodies, messages, HR Report categories and notes, private Operator
reasons, profile names and pictures, tokens, secrets, connection strings, and
thrown provider messages.

Monitor Clerk webhook delivery, Neon availability and migration state, Portal
connect/publish failures, Vercel Cron results, pending outbox work, provider
quotas, and billing. Optional analytics are not installed or enabled; see
[Privacy and limitations](privacy-and-limitations.md).

## Routine verification

- Run `bun run setup:check` after changing a key, origin, region, migration,
  Portal policy, Clerk webhook, or production domain.
- Run `bun run docs:check` and `bun run deploy:dry-run` after changing release
  instructions or configuration names.
- Use the protected [Manual real-service smoke](real-service-smoke.md) only with
  disposable or dedicated test identities. It is not a pull-request gate.
