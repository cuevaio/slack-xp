# Portal channel deletion/reset API research

## Conclusion

Portal v1 has **no supported channel deletion or reset API**. Channels are not authoritative database entities; they come into existence through use. Therefore there is no supported customer flow that lists channels and then deletes them, and no documented message cascade or missing-channel delete behavior to rely on.

## Listing channels

- The only channel list route is `GET /v1/environments/{envId}/channels`. It is a dashboard/archive view, not channel CRUD. It reads `channel_archive`, orders by `firstActiveAt` descending, supports `limit` (default 50, maximum 100) and an ISO timestamp `cursor`, and returns `{ channels, cursor }`. With no rows it returns `{ channels: [], cursor: undefined }` (serialized JSON omits the undefined cursor). Source: `/Users/cuevaio/projects/portal-mono/apps/api/src/routes/channels.ts:41-89`.
- This route requires `dashboardAuth` and scopes the requested environment to one of the caller's organizations. Dashboard auth accepts a Clerk session or `Authorization: Bearer pcli_...`; the latter is the token created by `portal login`. Sources: `/Users/cuevaio/projects/portal-mono/apps/api/src/routes/channels.ts:45-53`, `/Users/cuevaio/projects/portal-mono/apps/api/src/auth/dashboard.ts:1-14`.
- Archive rows are written best-effort on first channel activity. They are explicitly dashboard-only and are never authoritative or consulted on the hot path. Sources: `/Users/cuevaio/projects/portal-mono/apps/api/src/db/schema.ts:279-307`, `/Users/cuevaio/projects/portal-mono/apps/realtime/src/coordinator.ts:595-628`.
- The installed `@portalsdk/cli` exposes login/account, deploy, secrets, projects/keys/origins operations, but no channel list/delete command; its README describes the CLI as sign-in, config deployment, and secret management. Source: `/Users/cuevaio/projects/slack-xp/node_modules/@portalsdk/cli/README.md:1-110`.

## Deleting/resetting channels

- No `DELETE /v1/channels/{channelId}` route exists. The channel route file only deletes a member or ban and otherwise provides publish, membership, history, and member reads. Sources: `/Users/cuevaio/projects/portal-mono/apps/api/src/routes/channels.ts:92-290`, `/Users/cuevaio/projects/portal-mono/apps/api/src/app.ts:78-97`.
- Portal's endpoint specification states explicitly that channel CRUD is not in v1 because channels are not entities and exist by being used. Source: `/Users/cuevaio/projects/portal-mono/coordinator-rewrite/portal-endpoint-surface-v1.md:211-215`.
- `DELETE /v1/channels/{channelId}/members/{userId}` and `DELETE /v1/channels/{channelId}/bans/{userId}` are supported and idempotent, but they remove only that membership or ban. They do not delete/reset a channel. Sources: `/Users/cuevaio/projects/portal-mono/apps/api/src/routes/channels.ts:167-179`, `/Users/cuevaio/projects/portal-mono/apps/api/src/routes/channels.ts:201-212`.

## Messages and cascade behavior

- Since channel deletion does not exist, there is no supported deletion cascade for messages.
- Persistent messages and archive rows both store a plain `channelId`; messages do not reference `channel_archive`. The schema says `channelId` is “not an FK” because channels are not rows of authority. Deleting an archive row directly would therefore **not** cascade messages. Sources: `/Users/cuevaio/projects/portal-mono/apps/api/src/db/schema.ts:195-246`, `/Users/cuevaio/projects/portal-mono/apps/api/src/db/schema.ts:279-307`.
- The only relevant cleanup found is Portal's deployed smoke-test teardown, which connects directly to Postgres and separately deletes `messages` and `channel_archive` rows for each test channel. This is internal test cleanup, not an HTTP/SDK contract, and the separate statements confirm there is no archive-to-message cascade. Source: `/Users/cuevaio/projects/portal-mono/apps/realtime/scripts/smoke-deployed.ts:741-742`.

## Auth and base URLs

- All API routes are mounted below `/v1`. Source: `/Users/cuevaio/projects/portal-mono/apps/api/src/app.ts:78-97`.
- Server/admin channel operations use `Authorization: Bearer sk_...`, reject public keys, revoked/unknown keys, and any request carrying a browser `Origin`. Source: `/Users/cuevaio/projects/portal-mono/apps/api/src/auth/secret-key.ts:92-124`.
- Dashboard archive listing uses Clerk or `Authorization: Bearer pcli_...`, not `sk_`. Source: `/Users/cuevaio/projects/portal-mono/apps/api/src/auth/dashboard.ts:1-14`.
- The production control-plane base URL used by this app and the SDK/CLI is `https://api.useportal.co`; realtime HTTP/WS traffic uses `https://realtime.useportal.co`. This app strips one trailing slash before appending `/v1/...`. Sources: `/Users/cuevaio/projects/slack-xp/src/lib/portal/server.ts:46-47`, `/Users/cuevaio/projects/slack-xp/src/lib/portal/server.ts:84-100`, `/Users/cuevaio/projects/slack-xp/node_modules/@portalsdk/core/dist/index.js:1340`.
- The CLI permits a `PORTAL_API_URL` override for local development and sends `Authorization: Bearer ${PORTAL_SECRET}` for deploy/secret-key operations. Sources: `/Users/cuevaio/projects/slack-xp/node_modules/@portalsdk/cli/README.md:107-110`, `/Users/cuevaio/projects/slack-xp/node_modules/@portalsdk/cli/dist/index.js:2`.

## Missing-channel behavior

- A channel ID does not need to be pre-created: using it creates/binds coordinator state and records the archive lazily on first activity. Thus “missing channel” is generally not a channel-resource lookup state. Sources: `/Users/cuevaio/projects/portal-mono/apps/api/src/db/schema.ts:279-286`, `/Users/cuevaio/projects/portal-mono/apps/realtime/src/coordinator.ts:595-628`.
- `GET /v1/channels/{channelId}/history` queries by environment and channel ID and returns `{ msgs: [], hasMore: false }` when no persisted messages match; it does not first require a channel entity. Source: `/Users/cuevaio/projects/portal-mono/apps/api/src/routes/channels.ts:215-273`.
- A request to `DELETE /v1/channels/{channelId}` matches no registered route, regardless of whether the ID has ever been used, so callers receive the framework's unmatched-route 404 rather than a supported Portal channel-deletion result. Sources: `/Users/cuevaio/projects/portal-mono/apps/api/src/routes/channels.ts:92-290`, `/Users/cuevaio/projects/portal-mono/apps/api/src/app.ts:78-97`.
- The documented 404 `not_membership_channel` concerns membership operations on broadcast channels, not an absent channel. Source: `/Users/cuevaio/projects/portal-mono/coordinator-rewrite/portal-endpoint-surface-v1.md:96-101`.

## How slack-xp scripts interact with Portal

- `bun run portal:deploy` runs `scripts/portal-deploy.ts`, which temporarily patches the installed CLI bundle for config-version/duplicate-deploy compatibility and invokes `node <patched-cli> deploy`. It does not list, delete, or reset channels. Sources: `/Users/cuevaio/projects/slack-xp/package.json:6-16`, `/Users/cuevaio/projects/slack-xp/scripts/portal-deploy.ts:1-41`.
- `bun run smoke:real` runs `scripts/real-service-smoke.ts`, which delegates to `LiveRealServiceSmokeAdapter`. The adapter mints app sessions, constructs `@portalsdk/core` clients, exercises channel connections/messages, and probes anonymous-token origin policy; it performs no channel cleanup. Sources: `/Users/cuevaio/projects/slack-xp/scripts/real-service-smoke.ts:1-80`, `/Users/cuevaio/projects/slack-xp/src/lib/smoke/live.ts:415-492`.
- Setup verification similarly creates memberships, mints a token, connects through `@portalsdk/core`, sends test messages, and checks persistence. It does not reset the generated channels afterward. Source: `/Users/cuevaio/projects/slack-xp/src/lib/setup/live.ts:160-250`.
- Application server code calls control-plane endpoints directly with `Bearer ${PORTAL_SECRET}` for memberships, bans, tokens, and server publishing; observer history is read from the realtime base URL with a user token plus `x-portal-key`. Sources: `/Users/cuevaio/projects/slack-xp/src/lib/portal/server.ts:84-180`, `/Users/cuevaio/projects/slack-xp/src/lib/portal/server.ts:211-252`, `/Users/cuevaio/projects/slack-xp/src/lib/portal/server.ts:393-430`.

## Operational implication

Do not build a reset script around an inferred `DELETE /v1/channels/{id}` endpoint or by deleting dashboard archive entries. A true reset would require a new supported Portal platform operation that explicitly defines coordinator state, memberships/bans/inbox state, persisted message cleanup, archive cleanup, active connections, and idempotent missing-channel semantics.
