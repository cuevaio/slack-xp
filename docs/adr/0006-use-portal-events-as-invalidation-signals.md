# Use Portal events as invalidation signals

A hidden Portal channel carries versioned Office Events for reactions and immediate client updates. Reaction events are authoritative, while profile, report, removal, employment, and operator events only invalidate Neon-backed queries; clients accept server-authored events only from reserved senders and never treat duplicated, delayed, or imitated payloads as canonical application state.
