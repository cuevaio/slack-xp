# Portal Channel Extensions Do Not Produce Broadcasts

**Date:** July 23, 2026

**Affected environments:** Development and Production

**Status:** Reproduced with Portal's documented counter pattern

## Application Workaround

Portal Messenger no longer routes reactions through a channel extension. It persists `app.reaction.toggle` as an ordinary channel message and projects reaction state from the ordered `useChannel.messages` window. This gives connected clients live convergence and lets late clients rebuild the same state from history using Portal behavior that works in both Development and Production.

The workaround does not resolve the platform incident. The documented counter resolution test below remains the criterion for restoring confidence in hosted extension dispatch.

## Summary

Portal channel extensions are attached and advertised to clients, but they do not produce broadcasts.

The issue was first observed in a reaction extension. To rule out application code, the counter pattern from Portal's official extension documentation was deployed to new, isolated channels in both Development and Production. The counter failed in both environments at the same point: clients connected successfully and sent the documented namespaced message, but no extension broadcast arrived.

Ordinary Portal messages, presence, activity, history, and inbox updates continue working. The failure is isolated to channel extension execution or delivery.

## Documented Behavior

Portal's [Channel extensions guide](https://docs.useportal.co/guides/extensions) states:

> "Clients publish into the namespace, Portal hands your code the messages a batch at a time, and whatever you return is broadcast to everyone in the channel."

For a WebSocket extension, the documented send pattern is:

```ts
await channel.send({
  ephemeral: true,
  type: "counter.increment",
  content: {},
});
```

The documentation also says:

- Live broadcasts arrive as ordinary messages through `onMessage`.
- Late joiners receive state through `channel.ext.<handle>`.
- A degraded extension send rejects with `DegradedError`.
- `portal deploy` bundles and uploads attached extensions.
- Deployment is atomic: if anything fails, nothing changes.

## Initial Reaction Failure

The application has a durable reaction extension with:

```ts
{
  namespace: "reaction.",
  transport: "ws",
}
```

The active Development configuration contains the expected extension scripts:

```text
general       -> ext-general-reactions
announcements -> ext-announcements-reactions
```

The channel `ready` frame advertises:

```json
{
  "bindings": {
    "reaction.": "ws"
  }
}
```

This proves Portal advertised the namespace-to-transport route. It does not prove that the hosted extension script executed successfully.

When a client sends `reaction.toggle`:

- The sender receives no `reaction.state` broadcast.
- A second connected client receives no broadcast.
- No reaction snapshot appears under `ext.reactions`.
- The send does not reject with the documented `DegradedError`.

A direct multi-client SDK test reproduces the failure without React or the browser UI:

```sh
NEXT_PUBLIC_PORTAL_KEY=<publishable-key> \
PORTAL_SECRET=<secret-key> \
bun scripts/reaction-smoke.ts
```

Result:

```text
error: Reaction broadcast not received.
```

## Controlled Counter Test

To determine whether the reaction implementation was incorrect, a minimal counter matching Portal's documentation was tested independently.

The extension:

1. Owns the `counter.` namespace.
2. Uses `ws` transport.
3. Counts `counter.increment` messages in `onBatch`.
4. Stores the total with `ctx.storage`.
5. Returns `counter.state` in `broadcasts`.
6. Returns `snapshotDirty: true`.
7. Returns the current total from `onSnapshot`.

### Isolation Controls

Each environment used:

- A never-before-used channel ID
- One counter extension only
- No middleware
- No React or Clerk browser state
- Two direct `@portalsdk/core` clients
- Synthetic members and 15-minute scoped tokens
- `history: "none"`
- Message listeners registered before sending
- A ten-second broadcast timeout

No existing channels, messages, or real users were used.

### Development Result

Portal reported:

```text
1 channel override
Uploaded: 1 extension
```

Both clients reached `ready`. Client A sent the documented `counter.increment` message.

Result:

```text
error: Counter broadcast not received.
```

### Production Result

The same test was repeated with fresh Production credentials and another new channel.

Portal again reported:

```text
1 channel override
Uploaded: 1 extension
```

Both clients reached `ready`. Client A sent the same documented message.

Result:

```text
error: Counter broadcast not received.
```

After each experiment, the original `general` and `announcements` configuration was reactivated and verified through Portal's active-config API. Temporary files and credentials were removed.

## Conclusion

This is a Portal platform issue, not a reaction implementation issue.

The same failure occurs with Portal's documented counter pattern on fresh channels in both Development and Production. This rules out:

- Reaction payload validation
- Reaction state or toggle logic
- Batch deduplication
- React state synchronization
- UI rendering and CSS
- Middleware
- Message history
- Existing channel configuration or state

The failure occurs somewhere after Portal advertises the extension route and before clients receive the extension broadcast.

The exact internal cause is not yet proven. Possible causes include:

- The generated extension script was not uploaded correctly.
- Realtime dispatch cannot find or execute the script.
- The generated Durable Object binding or migration is invalid.
- The extension wrapper fails during initialization or batch handling.
- The extension is degraded internally, but the documented error is not surfaced.

## Requested Portal Checks

For one synthetic `counter.increment`, trace:

```text
client frame
-> namespace lookup
-> extension script dispatch
-> generated wrapper
-> onBatch
-> broadcast enqueue
-> client delivery
```

Please verify:

1. The generated counter script exists in the expected dispatch namespace.
2. Upload and realtime dispatch use the same Cloudflare account and namespace.
3. The script has the expected `EXTENSION` Durable Object binding and migration.
4. The extension invocation returns successfully.
5. `onBatch` receives `counter.increment`.
6. The returned `counter.state` broadcast is accepted and enqueued.
7. Any dispatch failure is visible in environment logs.
8. A degraded WebSocket extension rejects or reports errors as documented.

## Resolution Test

The issue is resolved when:

1. Clients A and B connect to a fresh channel.
2. A sends `counter.increment`.
3. A and B receive `counter.state`.
4. Client C connects afterward.
5. C receives the current counter at `ext.counter`.
6. No extension error occurs.

## References

- [Channel extensions](https://docs.useportal.co/guides/extensions)
- [Channels](https://docs.useportal.co/core/channels)
- [`useChannel`](https://docs.useportal.co/react/use-channel)
- [Errors](https://docs.useportal.co/core/errors)
- [Wire protocol](https://docs.useportal.co/wire-protocol)
- [Deploy and secrets](https://docs.useportal.co/config-cli/deploy-and-secrets)
- [Get active config](https://docs.useportal.co/api-reference/spec/tag/deploys/get/v1/configs/active)

## Repository References

- Reaction projection: `src/lib/portal/reactions.ts`
- Client integration: `src/components/portal-chat.tsx`
- Direct reaction test: `scripts/reaction-smoke.ts`
- Application PR: `cuevaio/slack-xp#30`
