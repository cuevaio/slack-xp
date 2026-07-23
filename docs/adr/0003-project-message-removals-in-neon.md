# Project message removals in Neon

**Status: Superseded by ADR 0009.** The teaching baseline has no removal projection or application database.

Portal's customer API cannot retract an arbitrary persisted message, so operator removal is represented by a Neon record and broadcast as a Portal System Event. Portal Messenger renders the message as a tombstone in live and historical views, while documentation states that this is application-level removal rather than erasure from Portal storage.
