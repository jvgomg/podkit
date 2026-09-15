---
id: TASK-521
title: 'Sweep task-ID references out of code, comments and test names'
status: To Do
assignee: []
created_date: '2026-09-15 22:45'
updated_date: '2026-09-15 22:45'
labels:
  - refactor
  - ready-for-agent
dependencies: []
references:
  - AGENTS.md
priority: low
type: chore
ordinal: 276500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The repo's rule is that code — file names, comments, test names — must not reference task IDs, acceptance-criterion numbers or milestones. It is widely violated: **156 files, 412 references** across `packages/`, `test-packages/` and `tools/`, of which **40 are inside `describe(...)` / `it(...)` names**.

One file (`lima-test-vm-binary.test.ts`) was cleaned while working nearby; the rest was left because a 156-file mechanical diff bundled into unrelated work is unreviewable, and because the substitution is not blind.

**Why it matters, beyond the rule.** A test named `transferBinary (AC3: atomicity)` tells a reader to go and find a ticket in order to learn what is being asserted, and that ticket may be closed, renumbered or archived. The behaviour is the durable thing; the ticket is scaffolding that outlived its build.

**This is not a regex job.** Each reference has to be replaced with a description of the *behaviour* it stood for, which means reading enough of the surrounding test to know what that is. The pattern that worked on the file already done:

- a header listing "the six TASK-NNN acceptance criteria" becomes a list of the behaviours pinned, in plain language
- `describe('transferBinary (AC1: copy + install + cleanup atomically)')` becomes `describe('transferBinary (copy + install + cleanup atomically)')` — the parenthetical was already descriptive, so only the ticket reference goes
- `// AC2: idempotency (sha256 match → skip)` becomes a sentence saying what idempotency means here

Watch for false positives: `AC` appears in unrelated contexts (AAC codecs, MAC addresses), so `\bAC[0-9]\b` is the narrow pattern, and every hit still needs eyes.

Assertions must not change. This is renaming. A test whose *body* needed adjusting to match its new name was misnamed in a way worth reporting rather than quietly fixing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No task ID, acceptance-criterion number or milestone reference remains in any .ts or .sh file outside backlog/
- [ ] #2 Every removed reference is replaced by a description of the behaviour it stood for, not deleted outright
- [ ] #3 No test assertion changes — the diff is naming and comments only
- [ ] #4 Unrelated 'AC' occurrences (AAC, MAC) are left alone
- [ ] #5 Full quality gate passes
<!-- AC:END -->
