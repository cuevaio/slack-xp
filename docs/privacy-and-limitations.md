# Privacy, retention, and limitations

> **Do not present a public fork as a private workplace or a production-complete
> collaboration platform.** The Shared Public Office is intentionally communal.
> A deployment owner controls who may authenticate, but the application has no
> tenant isolation, invitations, automated moderation, or application-level
> per-user publish rate limit.

## What each service retains

Portal is authoritative for persistent messages and history, presence, typing,
unread state, inbox state, and reaction events. Clerk is authoritative for
authentication and the current public New Hire Profile. Neon stores current
profile projections and application workflows; it never stores a duplicate
message body.

Deleting a Clerk account tombstones its Neon projection, clears the projected
name and picture, blocks future entry, and renders its preserved Portal
messages as **Former Employee**. It does not delete those messages from Portal.

A **Removed Message** is hidden by the Portal Messenger application with a Neon
projection and a visible tombstone. Portal's customer API cannot retract that
arbitrary persisted message, so its original body remains in Portal storage and
may remain retrievable by an authorized direct Portal client. Deployment owners
must not describe this action as erasure.

## HR Report privacy

An HR Report is private application workflow state. Neon stores stable subject
coordinates, reporter ID, an approved category, state, and timestamps. It does
not copy the reported message body, profile name or picture, or conversation
preview. Targeted Portal notifications omit the reporter, category, private
note, content, and mutable profile values. Operator reasons and notes remain in
the private audit and never enter public System Events, Office Events,
tombstones, or logs.

## Logs and analytics

Structured logs use fixed operation and status fields, a correlation ID, and
allowlisted stable identifiers. Message and event content, names, pictures, HR
Report details, private reasons, tokens, credentials, database URLs, upstream
response bodies, and thrown provider messages are redacted or never accepted by
the logging boundary.

Analytics are disabled by default: the repository installs no analytics SDK,
tracking pixel, or required telemetry service. A fork owner who opts in must
document the data flow, obtain any legally required consent, keep message and HR
Report content out of analytics, and update this privacy document.

## Application retention

The checked-in policy identifies application-owned cleanup candidates:

| Neon record | Candidate after |
| --- | --- |
| Office Days, completed outbox work, Removed Message projections | 30 days |
| HR Reports, Operator audits, reversed Terminations | 90 days |
| Pending outbox work, active Terminations | Never while pending or active |

The repository provides deterministic candidate selection, not an automatic
deletion job. A deployment owner must review, implement, and audit any cleanup
process appropriate to local policy. Deleting a Neon Removed Message projection
without deleting Portal content could make the original message visible again,
so safety and legal requirements take precedence over the nominal candidate
date. Portal and Clerk have their own retention controls and agreements.

## Product and safety limitations

- There is no automated content moderation or Portal content middleware.
  Operators act on private HR Reports manually.
- User messages are plain text and limited to 1,000 characters. The application
  adds no per-user server publish rate limit beyond capabilities and quotas
  enforced by the configured Portal service. Public deployments are vulnerable
  to spam and cost growth unless the owner restricts sign-in and monitors usage.
- All authenticated New Hires may publish in All Hands. Portal broadcast mode
  changes presentation and presence, not publish authorization.
- There is one Shared Public Office with fixed Office Channels and UTC Office
  Days, not private workspaces, organizations, direct messages, or tenant
  isolation.
- No uploads, embeds, rich Markdown, raw HTML, URL unfurling, or generative AI
  are supported.
- Operator access is a server-only Clerk user-ID allowlist, not a roles or
  organization system.
- Maintenance mode is an application boundary. Already issued Portal tokens
  retain their externally enforced lifetime and may require Portal-side
  containment.
- Fail-closed safety projections favor privacy over availability: a Neon outage
  hides Portal history rather than risking the reappearance of deleted profile
  data or Removed Message content.

Before launch, review the [ordered deployment guide](deployment.md), provider
terms, data locations, quotas, abuse controls, retention settings, and the laws
that apply to the deployment and its audience.
