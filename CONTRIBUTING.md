# Contributing

Portal Messenger: Corporate Edition accepts focused improvements that keep the Clerk and Portal learning path small and direct.

## Before Opening A Change

1. Read [CONTEXT.md](CONTEXT.md) and the relevant records in [docs/adr](docs/adr).
2. Search the GitHub issue tracker and follow [the issue process](docs/agents/issue-tracker.md).
3. Surface conflicts with an ADR rather than silently changing an authority boundary.
4. Never add credentials, copied production data, message bodies in logs, or a dependency on Portal's private repository.

## Local Workflow

This repository uses Bun exclusively and `bun.lock` is the only lockfile. Local development requires Clerk and Portal development environments.

```bash
bun install --frozen-lockfile
cp .env.example .env.local
bun run portal:deploy
bun run dev
```

Run the complete acceptance set before opening a pull request:

```bash
bun run test
bun run lint
bunx tsc --noEmit
bun run build
```

Tests must use narrow fetch stubs and must not contact live services. Keep direct pre-1.0 Portal package versions exact, example commands Bun-driven, and repository links relative.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
