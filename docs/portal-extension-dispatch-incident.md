# Portal Incident Report: Documented Channel Extension Contract Is Not Observed

**Reported:** July 23, 2026

**Confirmed affected environments:** Development and Production

**Affected feature:** Channel extensions using WebSocket transport

**Impact:** Extension-backed reactions do not update; ordinary Portal chat remains healthy

## Executive Summary

Portal Messenger has a durable reaction extension attached to `general` and `announcements`. The extension follows the authoring, attachment, sending, live-update, and snapshot patterns in Portal's published [Channel extensions guide](https://docs.useportal.co/guides/extensions).

In Development, Portal activates the configuration and tells connected clients that the `reaction.` namespace is bound to WebSocket transport. A client can send `reaction.toggle`, but neither the sender nor a second connected client receives the documented `reaction.state` broadcast. A joining client also receives no `reactions` snapshot.

This is reproducible without React through a direct multi-client SDK script. Persistent messages, presence, typing on the standard `general` channel, history, and inbox updates continue working in the same environment.

The strongest conclusion supported by the public documentation and observed evidence is:

> Portal advertises the documented extension route, but the documented extension result is not observable after the client sends into it.

The same failure occurs in both Portal environments when deploying the official documentation's counter example to brand-new channels and exercising it with two direct SDK clients. Those control experiments rule out reaction-specific code and establish this as a Portal platform contract issue affecting both environments in the clean project. The precise internal platform cause is not yet proven. A missing or failing Workers-for-Platforms dispatch script is the leading implementation-informed hypothesis, but this report does not present that internal mechanism as established fact.

## Why This Appears to Violate the Documented Contract

Four published guarantees are relevant.

### 1. Deployment includes extension upload and is atomic

Portal's [Deploy & secrets documentation](https://docs.useportal.co/config-cli/deploy-and-secrets#portal-deploy) says:

> "Deploying is atomic — if anything fails, nothing changes."

It also shows `portal deploy` reporting uploaded extensions. The [Channel extensions guide](https://docs.useportal.co/guides/extensions#2-attach-it-and-deploy) states:

> "The CLI reads each attached extension's manifest, validates namespaces, bundles each extension separately, and uploads it."

For this project, `portal deploy` succeeded and reported two uploaded extensions. The active-config API identifies both extension scripts. Nevertheless, neither extension produces observable output.

This does not prove that script upload failed, but it creates tension with the documented atomic deployment guarantee and warrants checking the uploaded script artifacts directly.

### 2. Live extension broadcasts arrive through `onMessage`

The [Channel extensions guide](https://docs.useportal.co/guides/extensions#live-updates-onmessage) says:

> "Broadcasts arrive as ordinary channel messages. Filter by the namespace."

The [useChannel documentation](https://docs.useportal.co/react/use-channel#params) also defines `onMessage` as being called for every persistent or ephemeral message delivered to the channel.

The reaction extension returns a namespaced `reaction.state` broadcast, but no connected client receives it through `onMessage`.

### 3. Joining clients receive extension snapshots in `channel.ext`

The [Channel extensions guide](https://docs.useportal.co/guides/extensions#why-a-snapshot-exists) says:

> "Portal caches that answer and hands it to every joining client in the connect frame."

It further states that the snapshot arrives as `channel.ext.<handle>` and is populated before the UI's first render. Under [Joining late: `channel.ext`](https://docs.useportal.co/guides/extensions#joining-late-channelext), it says a degraded extension is key-absent rather than `null`.

The observed `ready` frame has a `reaction.` binding but no `ext.reactions` snapshot. Because the binding proves the handle is attached, the missing snapshot is consistent with the documentation's degraded-extension case, not with an unattached extension.

### 4. Sends into a degraded extension should fail visibly

The [Channel extensions guide](https://docs.useportal.co/guides/extensions#sending-namespaced-types) says:

> "Sending into a namespace whose extension is currently degraded rejects with `DegradedError`. The channel itself keeps working."

The [Errors documentation](https://docs.useportal.co/core/errors) repeats that `DegradedError` represents a send into a degraded extension namespace.

The healthy-channel portion matches the observation: ordinary chat continues working. The visible-failure portion does not: the WebSocket extension send resolves in the SDK smoke test instead of rejecting with `DegradedError`, while no broadcast or snapshot is observed.

The [Wire protocol documentation](https://docs.useportal.co/wire-protocol#frames-on-the-channel-socket) describes WebSocket extension sends as `ephemeral` frames and says a refusal is returned in an `error` frame correlated by `ref`. Capturing that outgoing frame and any correlated response is the most important remaining client-side diagnostic.

## Documentation Alignment Review

The application implementation is aligned with the published extension guide in the following areas.

| Documented requirement | Application implementation | Assessment |
| --- | --- | --- |
| Manifest namespace ends in `.` | `namespace: "reaction."` | Aligned |
| Manifest selects `ws` transport | `transport: "ws"` | Aligned |
| Extension is attached by handle and source path | `reactions: "./extensions/reactions.ts"` | Aligned |
| Client sends a namespaced type | `type: "reaction.toggle"` | Aligned |
| WebSocket extension send is ephemeral | `ephemeral: true` | Aligned |
| Extension validates opaque content | `parseToggle()` validates message ID and reaction | Aligned |
| `onBatch` handles the full namespaced type | Filters for `reaction.toggle` | Aligned |
| Broadcast type starts with the namespace | Returns `reaction.state` | Aligned |
| State is persisted through `ctx.storage` | Stores reaction and batch state | Aligned |
| Changed state sets `snapshotDirty: true` | Returned after a valid toggle | Aligned |
| `onSnapshot` returns `{ snapshot: ... }` | Returns `{ snapshot: { reactions } }` | Aligned |
| Live clients consume broadcasts through `onMessage` | Merges `reaction.state` into component state | Aligned |
| Late joiners read by attachment handle | Reads `live.ext?.reactions` | Aligned |
| At-least-once batches are deduplicated | Tracks `epoch` and `batchSeq` | Aligned |
| Epoch-sensitive state resets on channel restart | Resets sequence guard when `epoch` changes | Aligned |

### Minor documentation/version drift unrelated to this incident

The current [portal.config.ts documentation](https://docs.useportal.co/config-cli/portal-config#message-middleware) names the channel middleware field `onPublish`, while this repository's installed `@portalsdk/config` version accepts `middleware`. This configuration deployed successfully, ordinary message moderation is separate from namespaced WebSocket extension traffic, and the active config contains the reaction extensions. It should be reconciled as package/documentation drift, but it does not explain the missing extension output.

## Confirmed Environment and Active Configuration

A clean Portal project was created to exclude inherited project configuration.

- Project: `portal-messenger-clean`
- Confirmed runtime environments: Development and Production
- Channels: `general` and `announcements`
- Extension handle: `reactions`
- Namespace: `reaction.`
- Transport: `ws`
- Portal CLI: 0.5.1
- Portal core SDK: 0.1.5
- Portal React SDK: 0.1.4
- Extension protocol: 0.1.0

The documentation site is currently unversioned and does not identify the exact package releases it describes. This comparison therefore records both the pinned package versions and the current published documentation as of the report date.

The documented [Get active config endpoint](https://docs.useportal.co/api-reference/spec/tag/deploys/get/v1/configs/active) confirms that the Development environment has an active configuration containing:

```json
{
  "general": {
    "mode": "standard",
    "extensions": {
      "reactions": {
        "script": "ext-general-reactions",
        "namespace": "reaction.",
        "transport": "ws"
      }
    }
  },
  "announcements": {
    "mode": "broadcast",
    "extensions": {
      "reactions": {
        "script": "ext-announcements-reactions",
        "namespace": "reaction.",
        "transport": "ws"
      }
    }
  }
}
```

The same `general` and `announcements` configuration is active in Production. A separate official-counter control was also run against Production as described below.

## Reproduction

The repository includes `scripts/reaction-smoke.ts`. It uses `@portalsdk/core` directly and does not depend on React rendering or browser Clerk state.

The script:

1. Creates scoped Portal sessions for two identities.
2. Connects both clients to the same channel.
3. Waits for both channel handles to reach `ready`.
4. Registers `message` listeners on both clients.
5. Sends `reaction.toggle` from client A.
6. Requires both clients to receive `reaction.state`.
7. Connects a third client and checks `ext.reactions`.
8. Toggles the reaction again and checks the removal broadcast.

Run:

```sh
NEXT_PUBLIC_PORTAL_KEY=<development-publishable-key> \
PORTAL_SECRET=<development-secret-key> \
bun scripts/reaction-smoke.ts
```

Actual result:

```text
error: Reaction broadcast not received.
```

The timeout occurs after both clients reach `ready` and the namespaced `send()` call resolves.

## Decisive Control: Official Documentation Counter Also Fails

To determine whether the application implemented reactions incorrectly, a semantically equivalent copy of the counter from Portal's [Channel extensions guide](https://docs.useportal.co/guides/extensions#1-author-the-extension) was deployed as a separate extension to a never-before-used Development channel.

The control matched the documented implementation:

```ts
class Counter {
  static manifest = {
    namespace: "counter.",
    transport: "ws",
  };

  private total = 0;

  constructor(private context: ExtensionContext) {}

  async onInit() {
    this.total = (await this.context.storage.get<number>("total")) ?? 0;
  }

  async onBatch({ messages }: BatchRequest) {
    const bumps = messages.filter(
      (message) => message.type === "counter.increment",
    ).length;
    if (bumps === 0) return;

    this.total += bumps;
    await this.context.storage.put("total", this.total);
    return {
      broadcasts: [
        { type: "counter.state", content: { total: this.total } },
      ],
      snapshotDirty: true,
    };
  }

  onSnapshot() {
    return { snapshot: { total: this.total } };
  }
}
```

Control conditions:

- New exact channel ID that had never been connected before
- One extension only
- No application middleware
- Namespace `counter.`
- WebSocket transport
- Two direct `@portalsdk/core` clients
- `history: "none"`
- Synthetic Portal members and scoped tokens
- Listeners registered before sending
- Documented send shape: `{ ephemeral: true, type: "counter.increment", content: {} }`
- Ten-second broadcast timeout

Deployment reported:

```text
1 channel override
Uploaded: 1 extension
```

Actual result:

```text
error: Counter broadcast not received.
```

The original `general` and `announcements` configuration was immediately reactivated after the test and verified through the active-config API.

This control rules out:

- Reaction payload validation
- Reaction toggle semantics
- Reaction storage shape
- Epoch-aware reaction batch deduplication
- React state synchronization
- Reaction DOM rendering or CSS
- Existing `general` or `announcements` coordinator state
- Message-history interaction
- Publish middleware interaction
- A race unique to the late-join snapshot check

The failure is now demonstrated with Portal's own documented extension pattern on a fresh channel. It is therefore appropriate to classify the incident as a Portal platform issue, while keeping the exact internal subsystem diagnosis open.

## Production Control

The official-counter control was repeated against the clean project's Production Portal environment rather than assuming that Development and Production share the same failure.

Production conditions:

- Fresh Production publishable and secret keys generated directly for the Production environment
- Never-before-used exact channel ID
- One counter extension only
- No middleware
- Same `counter.` namespace and `ws` transport
- Two direct `@portalsdk/core` clients
- Synthetic Production members and scoped 15-minute tokens
- Listeners registered before the documented ephemeral send
- Ten-second broadcast timeout

Production deployment reported:

```text
1 channel override
Uploaded: 1 extension
```

Production result:

```text
error: Counter broadcast not received.
```

The Production test therefore reproduces the Development failure independently.

After the experiment:

1. The original Production `general` and `announcements` config was reactivated.
2. The active-config API verified the restored content-addressed Production version and both channel keys.
3. Vercel Production Portal credentials were refreshed with a valid Production key pair through stdin.
4. Temporary credential and experiment files were removed.

No user messages or existing configured channels were used for the Production control.

## Wire Evidence

The sanitized `ready` frame contains:

```json
{
  "t": "ready",
  "channel": {
    "id": "general",
    "mode": "standard"
  },
  "me": {
    "anon": false,
    "capabilities": {
      "publish": true,
      "sendDirect": true
    }
  },
  "bindings": {
    "reaction.": "ws"
  }
}
```

This aligns with the [wire protocol's definition of `ready`](https://docs.useportal.co/wire-protocol#the-ready-frame): `bindings` is the extension namespace routing table used by `send()` to choose the extension transport.

The same connection receives normal Portal frames for persistent messages, presence, and activity. The inbox connection also receives entry and counter updates. This narrows the failure to the extension path rather than the channel, token, origin, or general realtime connection.

The supplied frame excerpt does not contain the outgoing reaction frame. Per the [wire protocol](https://docs.useportal.co/wire-protocol#frames-on-the-channel-socket), the expected client frame is:

```json
{
  "t": "ephemeral",
  "cl": "<client-tag>",
  "type": "reaction.toggle",
  "content": {
    "messageId": "<message-id>",
    "reaction": "like"
  }
}
```

The expected server result is a Portal message delivered to both clients with:

```json
{
  "type": "reaction.state",
  "content": {
    "messageId": "<message-id>",
    "reactions": {
      "like": ["<sender-id>"]
    }
  }
}
```

No `reaction.state` message is observed.

## What Is Proven

- The client authenticates and reaches `ready`.
- The active Development config contains both extension attachments and generated script names.
- The `ready` frame advertises `reaction.` with `ws` transport.
- Ordinary channel and inbox features work in the same environment.
- The application follows the documented extension authoring and consumption pattern.
- A direct multi-client SDK reproduction fails before any UI rendering step.
- The expected extension broadcast does not reach either connected client.
- The expected extension snapshot is absent.
- Portal's documented counter pattern fails in the same environment on a fresh channel.
- The fresh-channel counter test removes reaction-specific implementation and stale-channel state from the causal set.
- The same documented counter control fails independently in Production.

## What Is Not Yet Proven

- Whether the browser emitted the exact expected `ephemeral` frame during the reported click. The SDK smoke test exercises the equivalent send, but a browser Messages capture would close this evidence gap.
- Whether the extension script is absent from the dispatch namespace.
- Whether the script exists but throws during construction, `onInit`, `onBatch`, storage, or snapshot generation.
- Whether the coordinator has marked the extension degraded internally.
- Whether an `error` frame is generated but not surfaced as the documented `DegradedError` for WebSocket transport.

## Ranked Root-Cause Hypotheses

### 1. Hosted extension dispatch cannot execute uploaded extension code

**Confidence: high.**

The active config and `ready.bindings` prove that Portal resolved the reaction extension metadata. Independent failures of the documented counter on fresh Development and Production channels show that the problem is systemic to hosted extension execution in this project rather than authored reaction behavior. The absence of broadcasts is consistent with failure when dispatching to generated customer scripts or their Durable Objects.

Predictions:

- The named script is missing, has an invalid binding/migration, or returns a non-success response.
- Realtime or customer-worker logs show a dispatch error or timeout.
- The documented counter extension fails in both environments. This prediction has been confirmed twice.

### 2. The extension executes but fails during lifecycle handling

**Confidence: medium.**

A runtime-only difference could cause construction, `onInit`, `ctx.storage`, `onBatch`, or `onSnapshot` to fail even though the class-level test passes.

Predictions:

- The dispatch script exists.
- Invocation logs show an exception in the generated wrapper or authored extension.
- A no-storage extension succeeds while the reaction extension fails.

### 3. The channel coordinator retained stale extension runtime state

**Confidence: very low.**

The [deployment documentation](https://docs.useportal.co/config-cli/deploy-and-secrets#portal-deploy) says active connections retain prior configuration until restart. The documented counter failed on a never-before-used channel created after its configuration was activated, effectively ruling out stale coordinator configuration as the general explanation.

This hypothesis should only be revisited if platform logs show that the fresh channel loaded an unexpected configuration version.

### 4. The WebSocket send is rejected but the error is not surfaced as documented

**Confidence: medium.**

The public docs promise `DegradedError`, while the wire protocol allows an asynchronous `error` frame correlated by `ref`. The current smoke test proves no broadcast but does not retain a post-ready status/error listener or capture raw frames.

Predictions:

- Raw WebSocket capture shows an `error` frame referencing the reaction send's `cl` value.
- Adding persistent SDK error instrumentation exposes `DegradedError` or a generic `PortalError`.

## Implementation-Informed Hypothesis, Not a Documented Fact

Portal's internal API implementation contains a path where Workers-for-Platforms upload is skipped when required deployment inputs are absent:

```ts
if (!wfpConfigured(env)) return;
```

The required inputs are the Cloudflare account ID, API token, and dispatch namespace. Separately, realtime dispatch can suppress an unsuccessful extension invocation and return no extension response.

That combination could explain how extension metadata becomes active while the named script is unavailable or nonfunctional. However, it conflicts with the public statement that deployment is atomic. It should therefore be treated as a concrete operator investigation path, not the report's conclusion.

## Requested Founder and Operator Checks

### 1. Verify deployment artifacts against the documented atomic guarantee

For the active Development config, verify that these scripts exist in the expected dispatch namespace:

```text
ext-general-reactions
ext-announcements-reactions
```

Confirm that the script content corresponds to the active content-addressed configuration version.

### 2. Verify customer-worker Durable Object configuration

Each extension script should have the generated wrapper's expected configuration:

- `index.js` module entry point
- `EXTENSION` Durable Object binding
- `PortalExtension` class
- SQLite migration for `PortalExtension`

### 3. Verify upload and dispatch use the same account and namespace

Confirm that the control-plane uploader and realtime `CUSTOMER_WORKERS` binding target the same Cloudflare account and `portal-customer-workers` dispatch namespace.

### 4. Inspect one correlated invocation

Capture logs for one `reaction.toggle` from coordinator routing through customer-worker response. Record:

- Environment ID
- Channel ID
- Extension handle and namespace
- Script name
- Request kind and batch sequence
- Dispatch status
- Worker exception or timeout
- Returned `broadcasts` and `snapshotDirty`
- Snapshot refresh result

Do not include user tokens or message content beyond the synthetic smoke-test payload.

### 5. Compare SDK behavior with the documented degraded contract

If the extension is degraded, verify why the client send does not reject with `DegradedError` as documented. For WebSocket transport, confirm whether the error is expected synchronously from `send()` or asynchronously through the channel error callback.

### 6. Reproduce the completed official-docs counter control with platform logs

The counter control has already failed from the client perspective. Repeat that exact test while tailing control-plane, realtime coordinator, dispatch, and customer-worker logs. This should provide the shortest path to the first internal failure.

## Recommended Platform Improvements

These recommendations follow directly from the documented contract and the diagnostic ambiguity encountered here.

1. Enforce the documented atomic guarantee by failing deployment when any referenced extension script cannot be uploaded and verified.
2. Verify generated script existence, bindings, and Durable Object migration before activation.
3. Expose extension health by handle in the dashboard and active-config diagnostics.
4. Include structured extension dispatch failures in environment logs.
5. Make the documented `DegradedError` behavior explicit for WebSocket transport, including whether failure is synchronous or correlated asynchronously.
6. Distinguish "healthy snapshot not yet produced" from "extension degraded" if both can currently appear as a missing `ext` key.
7. Add an end-to-end test that deploys the official counter, sends from client A, observes client B, and validates a late-join snapshot.

## Resolution Acceptance Test

The incident is resolved when the following passes in a newly provisioned Development environment:

1. `portal deploy` uploads and activates the reaction extension in the target environment.
2. The active-config API names the expected scripts.
3. Clients A and B connect and receive the `reaction.` binding.
4. A sends `reaction.toggle`.
5. A and B receive `reaction.state`.
6. Client C connects after the mutation.
7. C receives current state at `ext.reactions` in its ready snapshot.
8. A toggles again.
9. Connected clients receive the removal state.
10. No extension or channel error occurs.

Executable test:

```sh
NEXT_PUBLIC_PORTAL_KEY=<development-publishable-key> \
PORTAL_SECRET=<development-secret-key> \
bun scripts/reaction-smoke.ts
```

Expected output:

```text
Reaction broadcast, toggle, and late-join snapshot passed.
```

## Primary Documentation References

- [Channel extensions](https://docs.useportal.co/guides/extensions)
- [`useChannel`](https://docs.useportal.co/react/use-channel)
- [Channels](https://docs.useportal.co/core/channels)
- [Errors](https://docs.useportal.co/core/errors)
- [Wire protocol](https://docs.useportal.co/wire-protocol)
- [Authoring `portal.config.ts`](https://docs.useportal.co/config-cli/portal-config)
- [Deploy & secrets](https://docs.useportal.co/config-cli/deploy-and-secrets)
- [Upload a config version](https://docs.useportal.co/api-reference/spec/tag/deploys/post/v1/deploys)
- [Activate a config version](https://docs.useportal.co/api-reference/spec/tag/deploys/post/v1/deploys/versionId/activate)
- [Get the active config](https://docs.useportal.co/api-reference/spec/tag/deploys/get/v1/configs/active)

## Repository References

- Application PR: `cuevaio/slack-xp#30`
- Extension: `extensions/reactions.ts`
- Client integration: `src/components/portal-chat.tsx`
- Direct reproduction: `scripts/reaction-smoke.ts`
- Focused tests: `tests/portal-baseline.test.ts`
- Portal upload implementation: `apps/api/src/lib/wfp.ts`
- Portal dispatch implementation: `apps/realtime/src/coordinator.ts`

## Conclusion

The application is materially aligned with Portal's published extension guide. Portal's own active configuration and channel `ready` frame confirm that the reaction extension is attached and advertised through the `reaction.` WebSocket namespace. More decisively, Portal's documented counter pattern fails on fresh channels in both Development and Production with no middleware or reaction-specific behavior. What fails is the documented extension result: no live broadcast, no late-join snapshot, and no visible degraded-extension error.

The report should be handled as a confirmed Portal platform contract incident, not as a confirmed Workers-for-Platforms credential incident. The fastest path to root cause is to trace one synthetic `counter.increment` through configuration lookup, coordinator dispatch, generated extension execution, broadcast enqueue, and snapshot refresh.
