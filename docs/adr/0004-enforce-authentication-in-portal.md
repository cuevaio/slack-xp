# Enforce authentication in Portal

Office Channels require `anonymous: false` in the deployed customer `portal.config.ts`; Clerk-gating React controls is not considered an authorization boundary. The repository includes a verification command and production fails closed when authenticated connection, anonymous refusal, origin policy, and persistent history cannot be proven against the configured Portal environment.
