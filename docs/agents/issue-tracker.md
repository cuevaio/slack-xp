# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

When enabled later, PRs use the same labels and states as issues through the corresponding `gh pr` commands. GitHub shares one number space across issues and PRs, so resolve ambiguous references with `gh pr view <number>` and fall back to `gh issue view <number>`.

## Publishing and fetching

When a skill says "publish to the issue tracker," create a GitHub issue.

When a skill says "fetch the relevant ticket," run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The map is one issue with linked child issues.

- **Map**: Label it `wayfinder:map` and keep Notes, Decisions-so-far, and Fog in its body.
- **Child ticket**: Link it as a GitHub sub-issue. If sub-issues are unavailable, add it to the map's task list and put `Part of #<map>` in the child body. Use `wayfinder:<type>` labels.
- **Blocking**: Prefer GitHub's native issue dependencies. If unavailable, put `Blocked by: #<n>` at the top of the child body.
- **Frontier query**: Select the first open, unassigned child without open blockers.
- **Claim**: Run `gh issue edit <n> --add-assignee @me` as the session's first write.
- **Resolve**: Comment with the answer, close the child, and append a context pointer to the map's Decisions-so-far.
