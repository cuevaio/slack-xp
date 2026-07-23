# Enforce publish authentication in Portal

**Status: Accepted, narrowed by ADR 0009.**

Both Office Channels require `anonymous: false`. Clerk-authenticated New Hires receive short-lived Portal tokens scoped to those channels. `PORTAL_SECRET` remains server-only. The unauthenticated experience is a sign-in and teaching explanation, not a projected conversation feed.
