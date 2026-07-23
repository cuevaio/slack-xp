# Manual real-service smoke

The `Manual real-service smoke` GitHub Actions workflow is the maintainer-only
end-to-end check for the deployed Portal Messenger test stack. It is deliberately
absent from pull-request and push CI and has no trigger other than
`workflow_dispatch`.

## Protected environment

Create a GitHub environment named `real-service-smoke`. Require reviewer
approval, restrict its deployment branches to the canonical protected branch,
and do not make its secrets available to forks. Configure these environment
variables:

- `SMOKE_APP_ORIGIN`: the exact HTTPS origin of the deployed test application
- `NEXT_PUBLIC_PORTAL_KEY`: the publishable key for its Portal test environment
- `SMOKE_NEW_HIRE_A_ID` and `SMOKE_NEW_HIRE_B_ID`: distinct, completed Clerk
  New Hires reserved for smoke runs
- `SMOKE_OPERATOR_ID`: a third completed Clerk New Hire that is also present in
  the deployment's `OPERATOR_CLERK_USER_IDS`

Configure these environment secrets:

- `CLERK_SECRET_KEY`: the Clerk test-instance Backend API key used to mint
  short-lived smoke sessions and repair a temporary profile edit
- `SMOKE_CRON_SECRET`: the deployed application's `CRON_SECRET`, under a
  workflow-specific name so its purpose is explicit

The workflow's first command validates that every value is present, the origin
is an exact HTTPS origin, the identities are distinct, and the acknowledgement
is correct. It makes no network call during this preflight and reports variable
names only. A missing or malformed value therefore stops the job before any
Clerk, Portal, or Neon state is changed.

## What a run proves

The workflow uses short-lived Clerk sessions to call the deployed authenticated
boundaries and receives Portal user tokens from the application; it never reads
the deployment's Portal secret or database connection string. The run proves:

- signed-out and Portal anonymous refusal plus allowed and unregistered origins;
- three distinct authenticated identities, including the configured Operator;
- Portal connection, persistent delivery, reconnect history, detailed presence,
  typing, channel and inbox unread state, and reaction replay;
- profile projection invalidation, reserved-sender rejection, message and New
  Hire Profile HR Reports, private Operator inbox notifications, deep links,
  and Operator dismissal;
- application-level Removed Message projection in live and reconnected history
  while confirming Portal still owns the persisted message;
- idempotent Office Day seeding, a repeated outbox flush, and scripted Office
  Character history;
- Send Home denial and the exact next-midnight UTC expiry;
- Termination, active disconnect, token and membership denial, and reinstatement.

Select `run_disposable_clerk_lifecycle` only in a Clerk development instance.
That gated portion creates a uniquely identified disposable Clerk user to prove
Clerk deletion tombstoning to Former Employee, active disconnect, and reconnect
denial. The runner refuses this portion against a production Clerk instance.

## Privacy and cleanup

Console output and the uploaded JSON artifact contain only fixed check names,
statuses, and fixed residual-resource categories. They never include service
tokens, secrets, message content, New Hire Profile values, HR Report details, or
private Operator reasons. Upstream response bodies and exception messages are
not printed.

Cleanup runs even after a failed check. It retries reinstatement, restores the
temporary Clerk profile, dismisses open HR Reports, deletes disposable users,
revokes created Clerk sessions, and reports any remaining category without its
private values. Portal conversation history, Removed Message records, and
Former Employee safety projections are retained by design: Portal is the
conversation authority and Neon preserves the application safety history.

Run the credential-only contract locally without service calls with:

```bash
bun run smoke:real -- --preflight
```
