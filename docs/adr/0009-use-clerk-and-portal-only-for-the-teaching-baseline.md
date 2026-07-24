# Use Clerk and Portal only for the teaching baseline

**Status: Accepted.**

Portal Messenger is an educational example. Clerk owns authentication and current identity; Portal owns memberships, scoped tokens, messages, history, presence, typing, and unread state.

The baseline intentionally excludes an application database, profile and safety projections, onboarding persistence, operator workflows, scheduled content, custom event protocols, and duplicate client caches. These are valid production concerns, but including them obscures the Portal learning path. Advanced examples may add them later without making the token route an application repair worker.

The application uses two standard Office Channels. General is backed by `general`; Announcements is backed by `announcements-v2` following ADR 0011. It renders Portal hook state directly and mounts only the selected channel, using the Portal inbox for inactive-channel attention.
