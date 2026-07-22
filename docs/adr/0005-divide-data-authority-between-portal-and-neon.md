# Divide data authority between Portal and Neon

Portal is the sole authority for persistent conversation messages, history, presence, typing, unread state, and reaction events. Neon stores the Clerk profile projection and application-owned workflow state such as onboarding, reports, removals, employment actions, operator audits, Office Days, and the publishing outbox; messages are never dual-written to Postgres.
