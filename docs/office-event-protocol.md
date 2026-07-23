# Office Event protocol

This document defines Office Event version 1. Office Events are persistent
Portal messages of Portal message type `office.event` on the hidden
`office-events:{YYYY-MM-DD}` channel. They never render as conversation
messages or contribute to visible unread attention.

## Envelope

Content is an exact runtime-validated discriminated union:

```ts
type OfficeEventBase<T extends string> = {
  version: 1;
  type: T;
  occurredAt: string;
  eventKey: `office-event:v1:${string}:${string}`;
};

type OfficeEventV1 =
  | (OfficeEventBase<"reaction.changed"> & {
      officeDay: string;
      officeChannelId: string;
      messageId: string;
      actorId: string;
      reaction: "👍" | "❤️" | "😂" | "😮" | "😢" | "🎉";
      operation: "add" | "remove";
    })
  | (OfficeEventBase<"profile.invalidated"> & { profileId: string })
  | (OfficeEventBase<"report.invalidated"> & { reportId: string })
  | (OfficeEventBase<"message-removal.invalidated"> & { messageId: string })
  | (OfficeEventBase<"employment.invalidated"> & { newHireId: string })
  | (OfficeEventBase<"operator.invalidated"> & { operatorId: string });
```

`occurredAt` is a canonical ISO timestamp. A retry of the same source operation
must reuse its deterministic event key; a later operation must use a new stable
source ID. Content must fit Portal's 2 KiB content limit and contain no extra
fields.

## Authoritative reactions

`reaction.changed` is the only authoritative Office Event. Its exact payload
contains the Office Day, visible Office Channel ID, message ID, actor ID,
`add` or `remove`, and one reaction from `👍 ❤️ 😂 😮 😢 🎉`. The Office Day
must agree with both channel IDs and the verified Portal sender must equal the
actor.

Clients fold reaction state last-write-wins by message, reaction, and actor,
using canonical occurrence time and event key as the deterministic tie-breaker.
An event applies only to a runtime-valid visible message in the named Office
Channel for the same Office Day. Reactions remain solely Portal-owned and are
not projected into Neon.

## Invalidation-only events

The remaining types carry one stable type-appropriate reference:

| Type | Canonical refetch |
| --- | --- |
| `profile.invalidated` | Current Clerk profile projection in Neon |
| `report.invalidated` | HR Report state in Neon |
| `message-removal.invalidated` | Removed Message projections in Neon |
| `employment.invalidated` | Send Home, Termination, or reinstatement state in Neon |
| `operator.invalidated` | Current server-evaluated Operator state and queue |

Invalidations never contain a name, picture, report category or note, message
body, removal reason or state, employment reason or state, reporter, or
Operator audit. A consumer discards embedded mutable state and refetches the
canonical Neon query.

## Reserved senders

- `profile.invalidated` is accepted only from `office-events:profiles`.
- Report, removal, employment, and Operator invalidations are accepted only
  from `office-events:operations`.
- A reaction sender must be the same authenticated actor named by its payload.
- IDs in the reserved `office-events:` and `office-character:` namespaces
  cannot connect as New Hires or appear in presence and typing.

The Portal envelope sender is validated before dispatch. A payload that merely
claims a reserved sender is not trusted.

## Validation, replay, and deduplication

The subscriber validates message type, persistence, current hidden channel,
size, exact object shape, version, supported discriminator, identifiers,
timestamp, event key, sender, Office Day, and type-specific payload before
calling a typed handler. It exposes no generic event send function or raw
hidden-channel message list.

The subscriber pages the current Office Day's event history to reconstruct
reactions. Live delivery, reconnect replay, pagination overlap, and outbox
retries are deduplicated by event key. Invalidation duplication is harmless
because it can only trigger another canonical read.

Malformed envelopes, unknown versions or types, extra fields, bad timestamps or
IDs, wrong channels or days, oversized content, ephemeral or retracted
envelopes, imitated reserved senders, and missing reaction targets are ignored.
Their content is not logged. Surrounding operational logs use only allowlisted
classification and stable correlation metadata; they never serialize event
content, message bodies, profile values, HR Report details, private reasons,
tokens, or upstream error messages.

Version 2 must use a new discriminator contract and event-key prefix. Clients
must continue to ignore versions they do not implement rather than guessing at
compatibility.
