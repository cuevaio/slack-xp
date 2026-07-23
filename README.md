# Portal Messenger: Corporate Edition

A small Next.js teaching application for Portal. Clerk authenticates each New Hire; Portal owns messages, persistent history, presence, typing, unread state, and channel membership.

## Learn The Flow

1. [`portal.config.ts`](portal.config.ts) defines the authenticated `general` standard channel, the `announcements` broadcast channel, and attached publish moderation.
2. [`src/app/api/office/portal/token/route.ts`](src/app/api/office/portal/token/route.ts) authenticates with Clerk, ensures both memberships, and mints a 15-minute scoped Portal token.
3. [`src/components/portal-chat.tsx`](src/components/portal-chat.tsx) constructs `Portal`, mounts `PortalProvider`, and directly renders `useChannel` state.
4. The same component uses `useInbox` for inactive-channel unread attention and mounts only the selected channel.

There is deliberately no application database, message cache, profile projection, webhook, workflow engine, cron job, or custom event protocol. Those concerns can be added after the Portal primitives are understood.

## Run Locally

You need Bun, a Clerk application, and a Portal environment.

```bash
bun install
cp .env.example .env.local
# Add your Clerk and Portal credentials.
bun run portal:deploy
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). Register that origin with Clerk and Portal.

`PORTAL_SECRET` is used only by the token route. It is never sent to the browser.

## Verify

```bash
bun run test
bun run lint
bunx tsc --noEmit
bun run build
```
