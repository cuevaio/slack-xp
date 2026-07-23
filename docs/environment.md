# Environment reference

Copy `.env.example` to `.env.local` for local work. Never commit `.env*` files
that contain real values. Only names beginning with `NEXT_PUBLIC_` may be
browser-visible; every other credential and allowlist remains server-only.

## Runtime variables

| Variable | Required | Exposure | Meaning and scope |
| --- | --- | --- | --- |
| `APP_ENV` | Recommended | Server | `local`, `test`, `preview`, or `production`. It overrides Vercel's inferred scope. Set explicitly in each Vercel project. |
| `SERVICE_MODE` | Recommended | Server | `mock` or `live`. Production refuses `mock`; deployed projects must use `live`. |
| `APP_ORIGIN` | Live | Server | Exact `http://` or `https://` browser origin registered with Clerk and Portal, with no path or trailing slash. Production requires HTTPS. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Live | Browser | Clerk publishable key. Use `pk_test_` outside production and `pk_live_` in production. |
| `CLERK_SECRET_KEY` | Live | Server secret | Backend key from the same Clerk application as the publishable key. |
| `CLERK_WEBHOOK_SECRET` | Live | Server secret | Signing secret for the deployment's `/api/webhooks/clerk` endpoint. |
| `NEXT_PUBLIC_PORTAL_KEY` | Live | Browser | Portal publishable key for the selected customer environment. |
| `PORTAL_SECRET` | Live | Server secret | Portal control-plane key used for policy deployment, membership, user tokens, bans, and controlled publishing. |
| `DATABASE_URL` | Live | Server secret | Pooled Neon Postgres connection string for this environment. |
| `CRON_SECRET` | Live | Server secret | At least 16 characters. Vercel uses it as the bearer token for the Office Day Cron route. |
| `OPERATOR_CLERK_USER_IDS` | Optional | Server | Comma- or whitespace-separated exact Clerk user IDs. Any malformed entry makes the entire allowlist grant no Operator access. |
| `PORTAL_MESSENGER_MAINTENANCE` | Optional | Server | `off` by default; `on` fails closed. Any other configured value is Installation Incomplete and is treated as active by the API gate. |

`VERCEL_ENV` is supplied by Vercel as a fallback when `APP_ENV` is absent.
`NODE_ENV` is framework-owned and is not a deployment selector.

## Scope matrix

Create distinct resources. Do not put production keys in local files, preview
deployments, or the development Vercel project.

| Scope | Clerk | Portal | Neon | Vercel |
| --- | --- | --- | --- | --- |
| Local mock | None | None | None | None |
| Local and deployed development | One Clerk development application | One Portal development environment | One Neon development database | A development project with `APP_ENV=preview` |
| Production | A separate Clerk production application | A separate Portal production environment | A separate Neon production database | A separate production project with `APP_ENV=production` |

In the development Vercel project, scope development values only to that
project's environments. In the production project, scope production values to
Production; do not make them available to Preview deployments from untrusted
branches. Vercel's encrypted setting does not make a `NEXT_PUBLIC_*` value
secret—the build intentionally exposes publishable keys.

## Non-runtime verification variables

The protected manual smoke workflow uses the `SMOKE_*` names documented in
[Manual real-service smoke](real-service-smoke.md). They belong to a protected
GitHub environment, not the application runtime, and are not needed by forks or
pull-request checks.

## Region

`vercel.json` selects one Vercel Function region. Choose the region closest to
the production Neon primary before the first production deployment. The region
is source configuration, not an environment variable or secret. Use the same
committed decision for predictable database latency.
