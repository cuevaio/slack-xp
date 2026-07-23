# Portal Platform Incident Report: Channel Extensions Are Routed but Not Executed

**Reported:** July 23, 2026  
**Affected product:** Portal channel extensions  
**Affected environment:** Newly provisioned Portal Development and Production environments  
**Severity:** High for extension users; core chat remains operational  
**Status:** Reproducible and isolated to hosted extension dispatch

## Executive Summary

A newly deployed channel extension is correctly recognized by Portal and advertised to connected clients, but messages routed into the extension namespace produce no extension output.

The affected application implements durable per-message reactions. A client sends `reaction.toggle`, the Portal connection advertises `reaction.` as a WebSocket extension binding, and the SDK routes the message into that namespace. However, neither the sending client nor another connected client receives the expected `reaction.state` broadcast. A late-joining client also receives no extension snapshot.

Core Portal functionality remains healthy: authentication, channel connection, persistent messages, presence, typing activity, history, and inbox updates all work. The failure is isolated to the hosted extension worker execution path after namespace routing.

An application-independent two-client smoke test reproduces the failure. The extension class itself passes focused state-transition and snapshot tests. This makes a React rendering or application state-consumption bug unlikely.

## User Impact

- A reaction picker can be opened and clicked, but no emoji or count appears.
- Other connected clients do not receive the reaction.
- Toggling a reaction cannot visibly add or remove participation.
- Newly connected clients do not receive durable reaction state.
- No client-facing error indicates that the extension failed.
- Ordinary channel behavior continues, making the failure look like an application bug.

## Environment

A clean Portal project was created specifically to eliminate stale application credentials or inherited project configuration as causes.

- Project: `portal-messenger-clean`
- Development environment: newly created
- Production environment: newly created
- Portal CLI: `@portalsdk/cli` 0.5.1
- Portal core SDK: `@portalsdk/core` 0.1.5
- Portal React SDK: `@portalsdk/react` 0.1.4
- Extension protocol: `@portalsdk/extension-protocol` 0.1.0
- Channels: `general` and `announcements`
- Extension handle: `reactions`
- Extension namespace: `reaction.`
- Extension transport: `ws`

Separate Development and Production credentials were generated. The same extension configuration was deployed to both environments. Required localhost and hosted application origins were registered.

No credentials, bearer tokens, or private user identifiers are included in this report.

## Deployed Configuration

The relevant channel configuration is equivalent to:

```ts
const publicOfficeChannel = {
  anonymous: false,
  middleware: [moderateChatMessage],
  extensions: { reactions: "./extensions/reactions.ts" },
};

export default defineConfig({
  channels: {
    general: publicOfficeChannel,
    announcements: { ...publicOfficeChannel, mode: "broadcast" },
  },
});
```

The extension manifest is:

```ts
static manifest = {
  namespace: "reaction.",
  transport: "ws",
};
```

On a valid toggle, `onBatch` persists the updated state and returns:

```ts
{
  broadcasts: [
    {
      type: "reaction.state",
      content: {
        messageId,
        reactions,
      },
    },
  ],
  snapshotDirty: true,
}
```

`onSnapshot` returns:

```ts
{
  snapshot: {
    reactions,
  },
}
```

## Reproduction

The repository contains `scripts/reaction-smoke.ts`, which exercises Portal directly without React or Clerk browser state.

The script:

1. Creates two Portal users with membership and scoped channel tokens.
2. Opens two independent Portal clients on `general`.
3. Waits for both channels to reach `ready`.
4. Sends a namespaced `reaction.toggle` from client A.
5. Waits for `reaction.state` on clients A and B.
6. Opens a third client and verifies the late-join snapshot.
7. Toggles the same reaction and verifies removal on both connected clients.

Run it with Development credentials provided through the environment:

```sh
NEXT_PUBLIC_PORTAL_KEY=<development-publishable-key> \
PORTAL_SECRET=<development-secret-key> \
bun scripts/reaction-smoke.ts
```

Actual result:

```text
error: Reaction broadcast not received.
```

The failure occurs after both clients reach `ready` and after the namespaced send resolves.

The same behavior was observed on both `general` and `announcements`.

## Wire Evidence

The channel `ready` frame includes:

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

This proves that:

- The client is connected to the intended environment.
- The deployed channel configuration matches `general`.
- Portal recognizes the extension namespace and transport.
- The SDK has enough information to route `reaction.toggle` into the extension path.

The same connection successfully receives ordinary Portal traffic:

```json
{
  "t": "batch",
  "msgs": [
    {
      "type": "message",
      "kind": "text",
      "content": {
        "text": "Example message"
      },
      "ephemeral": false
    }
  ]
}
```

Presence, typing activity, persistent messages, and inbox counters also update normally.

After sending `reaction.toggle`, the connection does not receive a message with:

```json
{
  "type": "reaction.state"
}
```

The `ready` frame also contains no `ext.reactions` state after attempted mutations.

## Expected Behavior

The sending client and every other connected client should receive an extension broadcast equivalent to:

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

After the snapshot refresh completes, a newly connected client should receive:

```json
{
  "ext": {
    "reactions": {
      "reactions": {
        "<message-id>": {
          "like": ["<sender-id>"]
        }
      }
    }
  }
}
```

## Actual Behavior

- The namespaced send resolves in the client SDK.
- Portal does not relay it as an ordinary generic ephemeral message, consistent with the extension route intercepting it.
- No `reaction.state` broadcast is received.
- No extension snapshot becomes available.
- No useful extension error is sent to the client.
- The channel itself remains connected and operational.

## What Has Been Ruled Out

### Incorrect project or environment keys

The JWT environment identifier, publishable key, server key, deployed configuration, and connected channel all belong to the newly created Development environment.

### Missing channel attachment

The `ready.bindings` record explicitly advertises `reaction.` with `ws` transport.

### Client parser failure

A focused regression test verifies that a valid `reaction.state` message is merged into renderable reaction state.

### React synchronization failure

The direct SDK smoke test reproduces the failure without React.

### Extension state-transition logic

The extension unit test verifies add, broadcast response, durable storage, and late-join snapshot output. Batch deduplication also tracks the Portal epoch so a restarted channel does not incorrectly discard new sequence numbers.

### CSS hiding the reaction

No reaction state reaches the clients. The failure occurs before DOM rendering.

### General channel connectivity

Persistent messages, presence, typing, history, and inbox updates continue to work on the same connection.

## Likely Platform Failure Boundary

The evidence places the failure in this sequence:

```text
Client send
  -> Portal SDK namespace routing
  -> Realtime coordinator extension lookup
  -> hosted customer extension dispatch
  -> extension onBatch
  -> extension broadcast enqueue
  -> connected clients
```

The first three steps are supported by the successful connection and advertised binding. The last visible successful point is the realtime coordinator recognizing the namespace. No evidence shows that the hosted customer extension worker runs successfully.

The most likely boundary is Workers-for-Platforms upload or dispatch.

## Primary Platform Hypothesis

The Portal control plane can activate a configuration that references extension scripts even when Workers-for-Platforms upload is not configured.

In `apps/api/src/lib/wfp.ts`, upload is skipped when any required input is absent:

```ts
function wfpConfigured(env: WorkerEnv): boolean {
  return Boolean(
    env.CLOUDFLARE_ACCOUNT_ID &&
      env.CLOUDFLARE_API_TOKEN &&
      env.WFP_DISPATCH_NAMESPACE,
  );
}

if (!wfpConfigured(env)) return;
```

`WFP_DISPATCH_NAMESPACE` is configured as `portal-customer-workers`, but the Cloudflare account ID and API token are deployment secrets.

If either secret is absent, invalid, or belongs to a different account:

1. Portal accepts and activates the channel configuration.
2. The realtime coordinator advertises the extension binding.
3. The extension script may not exist in the dispatch namespace.
4. The coordinator intercepts messages for `reaction.`.
5. Worker dispatch fails.
6. No broadcast or snapshot is produced.

This exactly matches the observed behavior.

## Other Plausible Platform Causes

- The API uploads to a different Cloudflare account or dispatch namespace than realtime uses.
- The extension script exists but lacks the expected `EXTENSION` Durable Object binding.
- The `PortalExtension` Durable Object migration was not applied.
- The dispatch script exists but fails during construction, `onInit`, or `onBatch`.
- A channel coordinator pinned a pre-deployment configuration. This is less likely because the behavior also occurred in a newly created project on both channels.
- Extension dispatch errors are being suppressed without enough client-facing or operator-facing telemetry.

## Requested Operator Checks

Please perform these checks in the Cloudflare account that owns `api.useportal.co` and `realtime.useportal.co`.

### 1. Verify API Worker secrets

```sh
wrangler secret list --config apps/api/wrangler.toml
```

Confirm that both names exist:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

Do not share their values.

### 2. Verify the dispatch namespace

Confirm that `portal-customer-workers` exists in the same Cloudflare account used by both the API upload code and realtime dispatch binding.

### 3. Verify uploaded extension scripts

Confirm that scripts corresponding to the `general/reactions` and `announcements/reactions` attachments exist in `portal-customer-workers` after `portal deploy` reports:

```text
Uploaded: 2 extensions
```

### 4. Verify Durable Object configuration

Each uploaded extension script should include:

- Module entry point `index.js`
- Durable Object binding named `EXTENSION`
- Durable Object class `PortalExtension`
- SQLite class migration for `PortalExtension`

### 5. Inspect dispatch errors

Tail realtime and customer-worker logs while running:

```sh
bun scripts/reaction-smoke.ts
```

Look for:

- Missing dispatch script
- Dispatch namespace mismatch
- Durable Object binding errors
- Migration precondition errors
- Constructor or `onInit` exceptions
- Non-2xx extension responses
- Dispatch timeouts

### 6. Verify configuration reload behavior

Ensure the test channel coordinator is created after the new configuration is activated, or use a fresh channel ID to exclude coordinator-level config pinning.

## Observability Gap

The current behavior is difficult for an extension author to diagnose because:

- `portal deploy` reports successful extension upload.
- The client receives an extension binding.
- Namespaced sends resolve.
- The extension produces no output.
- The channel remains healthy.
- No extension-specific error reaches `onError`.
- Missing snapshot state is indistinguishable from an extension that has never produced state.

Recommended platform improvements:

1. Fail deployment when customer-worker upload is unavailable outside local development.
2. Verify each uploaded dispatch script before activating the configuration.
3. Surface extension dispatch failures through structured logs with environment, channel, handle, namespace, script, and request kind.
4. Expose extension degradation through the SDK or a diagnostics endpoint.
5. Reject or visibly fail namespaced sends when the configured extension worker cannot execute.
6. Add an end-to-end deploy test covering upload, WebSocket routing, broadcast delivery, and late-join snapshots.

## Acceptance Test for Resolution

The issue is resolved when the following sequence passes against a newly provisioned environment:

1. Deploy a `ws` extension attached to a stable channel.
2. Connect clients A and B.
3. Send one namespaced mutation from A.
4. Receive the extension broadcast on A and B.
5. Disconnect B.
6. Send another mutation from A.
7. Connect client C.
8. Receive the current extension snapshot in C's `ready.ext` record.
9. Toggle the original mutation and receive the removal broadcast on all connected clients.

For this repository, the executable acceptance test is:

```sh
NEXT_PUBLIC_PORTAL_KEY=<development-publishable-key> \
PORTAL_SECRET=<development-secret-key> \
bun scripts/reaction-smoke.ts
```

Expected output:

```text
Reaction broadcast, toggle, and late-join snapshot passed.
```

## Repository References

- Application PR: `cuevaio/slack-xp#30`
- Extension: `extensions/reactions.ts`
- Client consumer: `src/components/portal-chat.tsx`
- Real-service reproduction: `scripts/reaction-smoke.ts`
- Focused tests: `tests/portal-baseline.test.ts`
- Portal upload path: `apps/api/src/lib/wfp.ts`
- Portal dispatch path: `apps/realtime/src/coordinator.ts`
- Portal API Worker config: `apps/api/wrangler.toml`
- Portal realtime Worker config: `apps/realtime/wrangler.toml`

## Conclusion

Portal successfully authenticates the clients, resolves the channel configuration, and advertises the extension namespace. It then fails to produce any output from the hosted extension path. The same failure occurs outside the UI with multiple direct SDK clients.

The highest-value next step is to inspect the production Workers-for-Platforms namespace and API Worker secret configuration while running the included smoke test. The current evidence strongly suggests that the activated Portal configuration references an extension worker that was not uploaded successfully or cannot be dispatched.
