# Cache conversations in Portal SQLite

Portal's per-channel Durable Object SQLite database is the durable hot cache and authority for Office Channel messages. Portal Messenger acquires every Office Channel when the workspace mounts, so Portal reads all recent histories in parallel and keeps each channel current even while another channel is visible.

TanStack Query stores only in-memory client snapshots and application-owned safety projections. Those snapshots remain visible while Portal reconnects or Neon-backed projections revalidate. Invalidation marks cached data stale and refetches active and hidden channel projections instead of resetting them, so a background repair does not create a loading state.

Portal Messenger does not persist a second browser or Neon copy of conversation history. A second durable copy could outlive a Portal retraction and briefly reveal content that an Operator already removed. Portal retractions update the live SDK state and the authoritative SQLite history together.
