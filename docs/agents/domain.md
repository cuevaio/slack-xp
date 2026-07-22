# Domain Docs

The repository uses a single-context domain documentation layout.

## Before exploring

Read `CONTEXT.md` at the repository root and relevant ADRs under `docs/adr/`. If either location does not exist, proceed silently. Domain-modeling workflows create these files lazily when decisions or terminology are resolved.

## Layout

- `CONTEXT.md`: shared glossary and domain model
- `docs/adr/`: architectural decision records
- `src/`: implementation

Use terms exactly as defined in `CONTEXT.md`. If a needed concept is absent, reconsider whether it belongs in the domain vocabulary or note it for domain modeling.

If proposed work contradicts an ADR, surface the conflict explicitly instead of silently overriding the decision.
