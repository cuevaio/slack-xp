# Contributing

Portal Messenger: Corporate Edition is MIT-licensed and accepts focused
improvements that keep it useful to an ordinary Portal customer.

## Before opening a change

1. Read [CONTEXT.md](CONTEXT.md) and the relevant records in
   [docs/adr](docs/adr). Use the defined product terms.
2. Search the GitHub issue tracker. For repository process and the canonical
   labels, see [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).
3. Keep one issue per change. Surface a conflict with an ADR instead of silently
   changing an authority or safety boundary.
4. Never add credentials, copied production data, private moderation details,
   message bodies in logs, or a dependency on Portal's private repository.

## Local workflow

This repository uses Bun exclusively and `bun.lock` is the only lockfile.

```bash
bun install --frozen-lockfile
cp .env.example .env.local
bun run dev
```

Local development requires a Clerk development application, a Portal
development environment, and a Neon development database. Copy `.env.example`
to `.env.local`, provide every required value, apply migrations, deploy the
Portal policy, and run `bun run setup:check` before starting feature work.

Run the checks that apply to the change, then the complete acceptance set:

```bash
bun run lint
bunx tsc --noEmit
bun run build
bun run test:unit
bun run test:server
bun run test:browser
bun run docs:check
bun run deploy:dry-run
```

Install the browser once with `bunx playwright install chromium`. Pull-request
tests must use controlled adapters or deterministic fixtures and must not
contact live services. The maintainer-only real-service workflow is documented
separately in [docs/real-service-smoke.md](docs/real-service-smoke.md).

## Documentation contracts

Update the relevant product, architecture, setup, environment, protocol, or
operations document whenever a contract changes. Keep Portal package versions
exact, keep example commands Bun-driven, and use relative links for repository
documents so `bun run docs:check` can validate them.

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).
