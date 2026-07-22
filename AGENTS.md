<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Toolchain

- Use Bun; `bun.lock` is the only lockfile. Install with `bun install` and run the app with `bun run dev`.
- Verification commands are `bun run lint`, `bunx tsc --noEmit`, and `bun run build`. No automated test suite is configured.
- For a focused Biome check, run `bunx biome check <path>`. `bun run format` writes formatting across the repository; it is not a lint-fix command.

## Application

- This is one Next.js App Router application, not a workspace. Its real entrypoints are under `src/app/`; the README's `app/page.tsx` path is stale.
- Import `src/` modules through the `@/*` alias.
- Tailwind CSS v4 is configured in `src/app/globals.css` through `@import "tailwindcss"` and `@theme`; there is no `tailwind.config.*` file.

## Project Process

- Issues and PRDs live in GitHub Issues; follow `docs/agents/issue-tracker.md`.
- Triage uses the five canonical labels documented in `docs/agents/triage-labels.md`.
- Before domain work, follow `docs/agents/domain.md`; read root `CONTEXT.md` and `docs/adr/` when they exist.
