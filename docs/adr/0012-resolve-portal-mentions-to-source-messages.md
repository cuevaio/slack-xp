# Resolve Portal mentions to source messages

**Status: Accepted.**

The Mentions panel must show every retained mention with its source message and open that exact message in its Office Channel. Portal's public `InboxItem` type leaves `data` opaque, but the hosted platform currently emits built-in mention items with `{ channelId, seq, from }`.

Portal Messenger validates those coordinates at runtime and uses the authenticated user's token with Portal's documented history range endpoint to resolve each `(channelId, seq)` to one source message. Resolution is bounded to eight concurrent history requests and starts for retained inbox items as soon as the authenticated inbox is available, so independently viewing a source message can use exact ID correlation before the Mentions panel opens. Returned sequence and sender fields must match the requested coordinates; malformed, missing, retracted, inaccessible, and failed results remain visible as unavailable mentions instead of disappearing. The app keeps no second durable notification or message store.

Selecting a mention does not change read state. It opens the source Office Channel, pages backward through Portal history until the resolved message ID is rendered, and scrolls that message into the chat viewport. A mention item is marked read only by exact resolved message ID when its corresponding source message intersects the visible chat region, whether the user arrived through the panel or navigated to the message independently. Sender-and-timestamp fallback matching is not permitted.

This decision deliberately accepts a compatibility risk around Portal's currently undocumented mention `data` shape. If Portal changes that payload, the panel degrades to unavailable rows without misrouting users or marking items read. A documented source-message identifier on built-in mention items remains the preferred platform contract.
