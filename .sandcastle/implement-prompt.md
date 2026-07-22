# TASK

Implement issue {{TASK_ID}}: {{ISSUE_TITLE}}

Read the issue and its comments using `gh issue view {{TASK_ID}} --comments`. If it has a parent PRD, read that too.

Only work on the specified issue.

Work on branch `{{BRANCH}}`. Make commits and run the required verification.

# CONTEXT

Before domain work, read `CONTEXT.md` and the relevant ADRs under `docs/adr/`. Use the domain terms defined there and surface any conflict with an ADR instead of silently overriding it.

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repository and gather the context needed to complete the task. Pay particular attention to existing tests and established patterns around the code being changed.

# EXECUTION

When applicable, use a red-green-refactor loop:

1. RED: write one failing test
2. GREEN: implement enough to pass it
3. REPEAT until the task is complete
4. REFACTOR without changing behavior

Keep the change focused on the issue. Do not modify unrelated user work.

# FEEDBACK LOOPS

Before committing, run:

1. `bun run lint`
2. `bunx tsc --noEmit`
3. `bun run build`

Run relevant tests when the changed area has test coverage.

# COMMIT

Commit the completed work with a concise message that explains the task and key decision. Do not close the issue; the merge phase handles that.

If the task cannot be completed, comment on the issue with the work performed and the remaining blocker.

Once complete, output `<promise>COMPLETE</promise>`.

# FINAL RULE

Only work on this single issue.
