# Project Clerk profiles into Neon

**Status: Superseded by ADR 0009.** The teaching baseline has no profile projection or application database.

Clerk is the authority for a New Hire's public name and picture, while a verified Clerk webhook projects the current profile into Neon through Drizzle. Portal messages retain the stable Clerk user ID rather than an identity snapshot, so both historical and live attribution resolve to the latest profile; webhook processing publishes a lightweight Portal event to invalidate connected clients immediately. Deleting a Clerk account tombstones its projection so preserved messages render as Former Employee without retaining the public name or picture.
