# Project reactions from persistent Portal messages

**Status: Accepted.**

Portal Messenger persists each reaction toggle as an ordinary `app.reaction.toggle` message in the target Office Channel. The client folds the ordered Portal message window into reaction summaries and hides reaction records from the conversation. The New Hire identity comes from the Portal message envelope, and a sender-scoped mutation ID prevents one logical event from being applied twice.

This design uses Portal's working persistent-message path for optimistic local updates, live multi-client delivery, ordering, history, pagination, and retractions. It supersedes ADR 0009's exclusion of custom event protocols only for reactions. It does not add an application database or duplicate cache.

For a visible conversation message, the projection is complete: Portal history is a contiguous newest-first sequence, so all later reaction records have already loaded by the time pagination reaches their target. A client does not project complete state for conversation messages it has not loaded.

Persistent reaction records consume sequence numbers. They therefore advance channel and inbox unread positions even though the records do not render as conversation messages. Direct multi-client controls measured this behavior in both the standard and broadcast Office Channels. A dedicated reaction channel would isolate unread and history, but would add another membership, token scope, socket, lifecycle, and pagination path. The teaching baseline accepts the same-channel unread effect to keep reactions small, reliable, and Portal-only.

The hosted reaction extension is retired while Portal extension broadcasts remain unavailable. The platform incident and independent counter reproduction remain documented in `docs/portal-extension-dispatch-incident.md`.
