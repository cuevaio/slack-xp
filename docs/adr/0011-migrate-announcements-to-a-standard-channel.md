# Migrate Announcements to a standard channel

**Status: Accepted.**

Both Office Channels must provide the same membership, detailed presence, typing, mentions, and inbox behavior. Portal fixes a channel's `mode` when that channel is first used, so deploying `mode: "standard"` for the existing production `announcements` channel cannot convert its broadcast coordinator.

Announcements moves to a new `announcements-v2` Portal channel in the existing project. The application continues to display the channel as "Announcements." A new Portal project is rejected because `general` is already correct, project migration would rotate application credentials, and Portal has no public project-level history import that preserves message IDs and timestamps.

The old `announcements` channel remains an unmodified production archive. `scripts/migrate-announcements.ts` copies its persistent, non-retracted history through public Portal APIs. Before any target mutation, a complete dry preflight validates transformed content against Portal's 2 KB limit and validates reaction dependencies. It records the source message ID and timestamp in `content.portalMigration`, remaps reaction target IDs, adds historical senders as members after replay, and omits declared mentions so historical messages do not create new mention notifications. Reactions whose source messages are absent or retracted are omitted and reported as orphans; every copied reaction still targets a valid copied message. The UI uses the recorded timestamp when rendering migrated chat messages.

The migration is resumable: copied records are recognized by `content.portalMigration.sourceMessageId`. Portal does not expose arbitrary backdated publishing or retraction through the public admin API, so migrated records receive new Portal IDs and sequence numbers, retracted source records remain absent, and the source archive is retained for rollback and audit.

## Production sequence

1. Schedule a short write freeze for Announcements. Do not migrate while users can continue publishing to the source channel.
2. Deploy `portal.config.ts` with `bun run portal:deploy`. This registers `announcements-v2` as standard before first use and does not change the immutable old channel.
3. Run `bun run portal:migrate-announcements` with production `PORTAL_SECRET` to inspect the source count without writing.
4. During the write freeze, run `bun run portal:migrate-announcements --apply`. Re-running the command safely skips records already copied.
5. Verify the reported active, migrated, skipped, reaction, and member counts. Run the application test suite and a Portal smoke test against `announcements-v2`.
6. Deploy the application cutover, which scopes new tokens and memberships to `general` and `announcements-v2`.
7. End the write freeze after confirming publish, typing, member lookup, mention delivery, notification read state, and reaction reconstruction in both Office Channels.

Before step 6, rollback means leaving the application on the old `announcements` ID; copied target data can remain dormant. After new writes begin on `announcements-v2`, do not switch writers back without reconciling the two histories.
