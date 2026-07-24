# Portal mention notifications

Research date: 2026-07-24. Sources are current first-party Portal documentation and the local Portal source checkout.

## Conclusion

A per-authenticated-user notifications panel for mentions can be built with Portal's existing inbox and existing **standard membership channels**. Dedicated notification channels are not needed. Portal's automatic mention delivery is membership-based. Portal Messenger therefore migrated Announcements from its original broadcast channel to the standard `announcements-v2` channel; see ADR 0011.

Use `useInbox()` with `where: { type: { eq: "mention" } }`, then group the returned `items` in application code by the documented `item.channelId`, date, or another documented field. Portal describes the inbox as a per-user, cross-channel feed and `useInbox` as an accumulated reactive list suitable for rendering a panel. An inbox view is a client-side lens over the one per-user inbox connection, not another channel or socket. [Inbox](https://docs.useportal.co/core/inbox/) · [`useInbox`](https://docs.useportal.co/react/use-inbox/)

Dedicated channels would add a second message stream, memberships, history, and permissions without improving the inbox's cross-channel query. If a future notification needs richer app-owned data unrelated to a source message, use Portal's server-side [user notification endpoint](https://docs.useportal.co/api-reference/spec/tag/notifications/post/v1/users/userId/notifications) or a config `notify` bridge, both of which write inbox items directly.

## What the inbox provides

- `items` are individual targeted events, including mentions, with `id`, `type`, optional `title`, opaque `data`, optional `channelId`, `at`, `read`, and `markAsRead()`. They are recency-sorted and accumulated across channels. [Inbox](https://docs.useportal.co/core/inbox/) · local SDK type: `/Users/cuevaio/projects/portal-mono/apps/example-linear/node_modules/@portalsdk/core/dist/index.d.ts:371-384`
- `useInbox` filters on `type`, `channelId`, `read`, `muted`, and scalar fields in `data`. `unseen` is scoped to the filtered view, while `counter` and `markAllRead()` remain global. There is no server-side group-by; grouping the filtered `items` array is application work. [`useInbox`](https://docs.useportal.co/react/use-inbox/) · filter implementation: `/Users/cuevaio/projects/portal-mono/apps/example-linear/node_modules/@portalsdk/core/dist/index.js:1683-1767`
- Each item has independent read state. `item.markAsRead()` affects only that item. `markAllRead()` affects every inbox item, not merely the current filtered mention view; a scoped "mark all mentions read" must iterate that view and call each item's method. [Inbox](https://docs.useportal.co/core/inbox/) · [in-app notifications guide](https://docs.useportal.co/guides/in-app-notifications/)
- Inbox channel-row read state and channel message read state are separate watermarks. Reading a notification item does not mark its source channel read, and marking a source channel read does not implicitly mark individual mention items read. [Inbox](https://docs.useportal.co/core/inbox/) · [Channels](https://docs.useportal.co/core/channels/)
- Muting suppresses ordinary channel unread aggregation but not addressed items: a mention from a muted channel still arrives and contributes to the badge. [Inbox](https://docs.useportal.co/core/inbox/)

## Mention schema and message lookup

Messages declare mentions as `mentions: [{ userId }]`. Portal verifies declared users against channel membership, deduplicates them, and caps the count. The persisted message envelope retains `mentions`; persistent messages have a per-channel `seq`, while ephemeral messages are not persisted and have no history. [ClientPublishRequest](https://docs.useportal.co/api-reference/spec/models/ClientPublishRequest) · [WireMessage](https://docs.useportal.co/api-reference/spec/models/WireMessage) · [Channels](https://docs.useportal.co/core/channels/)

For each verified mention, the current platform implementation writes an inbox item with this shape:

```ts
{
  id: `mention_${seq}_${userId}`,
  type: "mention",
  data: { channelId, seq, from: senderId },
  channelId,
  at: timestamp,
}
```

An `@everyone`/`@channel` expansion uses the same `type` and adds `data.everyone: true`. Source: `/Users/cuevaio/projects/portal-mono/apps/realtime/src/coordinator.ts:1387-1423`.

This payload is an implementation observation, not part of the documented public `InboxItem` contract; Portal documents `data` as opaque and does not promise mention-specific fields. ADR 0012 records the decision to validate and use these coordinates for the required exact-message panel while degrading safely when they are absent.

If Portal documents the built-in mention data contract in the future, an exact message preview could resolve `(channelId, seq)` against the existing source channel:

- Use already-loaded `useChannel` messages when the source message is present.
- Otherwise fetch that channel's history range (`?from={seq}&to={seq}`) or page with `loadPrevious()`. Portal exposes history per channel, not a cross-channel message query. [History API](https://docs.useportal.co/api-reference/spec/tag/channels-client/get/v1/channels/channelId/history) · [Channels](https://docs.useportal.co/core/channels/)

There is no need to keep all channels mounted merely to receive mentions: the inbox has its own socket and backlog. `onItem` is only for arrivals after mount; render the initial and ongoing panel from `items`. [`useInbox`](https://docs.useportal.co/react/use-inbox/) · [wire protocol](https://docs.useportal.co/wire-protocol/#the-inbox-socket)

## Persistence and retention

- Persistent source messages are stored, sequence-ordered, available to late joiners through history, and returned as tombstones after retraction. Ephemeral messages are not stored. [Channels](https://docs.useportal.co/core/channels/) · [History API](https://docs.useportal.co/api-reference/spec/tag/channels-client/get/v1/channels/channelId/history)
- Inbox items and their read flags are stored in the user's inbox Durable Object and returned in the inbox `ready` snapshot after reconnect. Current implementation: `/Users/cuevaio/projects/portal-mono/apps/realtime/src/inbox.ts:58-79,85-96,118-130`.
- The current implementation retains at most 200 inbox items and prunes items older than 30 days, lazily when a new item is inserted. There is no inbox pagination API in the documented surface. Constants: `/Users/cuevaio/projects/portal-mono/apps/realtime/src/constants.ts:76-79`; pruning/query: `/Users/cuevaio/projects/portal-mono/apps/realtime/src/inbox.ts:269-279,300-310`.
- The item id is an idempotency key, so reconnect/redelivery does not create duplicate panel rows. [Inbox](https://docs.useportal.co/core/inbox/) · [`useInbox`](https://docs.useportal.co/react/use-inbox/)

These retention limits mean Portal's inbox is suitable for a recent notifications panel, not an unbounded notification archive. Dedicated channels would not change that inbox limit; a permanent audit/archive requirement would need application-owned persistence or a separately designed product requirement.

## Identity, membership, and permissions

- The inbox is per identified user. Anonymous users have no persistent inbox; `useInbox` is permanently empty for them. Portal JWT identity changes re-authenticate the inbox in place. [Tokens and auth](https://docs.useportal.co/core/tokens-and-auth/) · [Inbox](https://docs.useportal.co/core/inbox/)
- For ordinary mentions, the recipient must be a member of the source standard channel. Current intake drops self-mentions, duplicates, and non-members; the accepted message carries only the verified mention list. `/Users/cuevaio/projects/portal-mono/apps/realtime/src/coordinator.ts:1280-1285,1513-1528`
- Broadcast channels have no membership concept, while mention verification is membership-based. Both current Office Channels are therefore standard channels. The original broadcast `announcements` channel is retained only as a migration archive. [Members API](https://docs.useportal.co/api-reference/spec/tag/channels-client/get/v1/channels/channelId/members) · `/Users/cuevaio/projects/portal-mono/apps/realtime/src/coordinator.ts:1280-1285,1513-1528`
- `@everyone`/`@channel` applies to membership channels, is capability-gated and rate-limited, and expands into one per-user inbox item. [Mention model](https://docs.useportal.co/api-reference/spec/models/Mention) · `/Users/cuevaio/projects/portal-mono/apps/realtime/src/coordinator.ts:1287-1310,1402-1423`
- Channel authorization remains authoritative for connecting and publishing. Tokens may also be scoped to named channels/capabilities. [Portal config authorization](https://docs.useportal.co/config-cli/portal-config/#authorization) · [token minting](https://docs.useportal.co/api-reference/spec/tag/tokens/post/v1/tokens)
- Adding a member makes the standard channel appear in that user's inbox; removing the member removes that channel's inbox row. [Add member](https://docs.useportal.co/api-reference/spec/tag/channels-admin/post/v1/channels/channelId/members) · [remove member](https://docs.useportal.co/api-reference/spec/tag/channels-admin/delete/v1/channels/channelId/members/userId)
- Current source removes the conversation row on membership removal but does not delete existing targeted items. Therefore old mention items may remain in the retained inbox item ring even after the source channel row disappears; the application should tolerate a missing/inaccessible source when navigating old items. `/Users/cuevaio/projects/portal-mono/apps/realtime/src/inbox.ts:202-209`

## Recommended shape for Portal Messenger

1. Keep ordinary mentions on `general` and any other standard membership channels where the source messages already live.
2. Render a mention-only `useInbox` view and group its `items` client-side.
3. Resolve the currently emitted `(item.channelId, item.data.seq)` through Portal's history range endpoint to render and navigate to the exact source message. Keep rows visible as unavailable when coordinates cannot be resolved.
4. Mark an individual mention item read only when its resolved source message is visible in the chat viewport. Opening the panel, selecting a row, or opening a channel does not mark it read.
5. Handle expired, retracted, removed-membership, or otherwise unavailable source messages as a normal "message unavailable" state.
6. Consider custom inbox notifications, not dedicated channels, if rich payloads become requirements. A config `notify` bridge on a message that already declares a Portal mention creates an additional item, so account for duplicate built-in/custom items and badge counts before choosing that design.
