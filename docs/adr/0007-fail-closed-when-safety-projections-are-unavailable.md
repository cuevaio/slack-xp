# Fail closed when safety projections are unavailable

**Status: Superseded by ADR 0009.** The teaching baseline has no Neon-backed safety projections.

Portal Messenger does not render raw Portal history when Neon cannot provide the profile and message-removal projections needed to interpret it safely. A recent verified projection remains usable while a failed background request is retried, but once that projection exceeds the bounded safety age the affected history fails closed. When a new sender cannot yet be verified, the previously verified prefix remains visible while the new messages stay hidden. Reduced availability is preferred over allowing Removed Message content or deleted profile data to reappear during a sustained database outage.
