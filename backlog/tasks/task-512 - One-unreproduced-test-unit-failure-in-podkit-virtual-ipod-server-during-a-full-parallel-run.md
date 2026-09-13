---
id: TASK-512
title: >-
  One unreproduced test:unit failure in @podkit/virtual-ipod-server during a
  full parallel run
status: To Do
assignee: []
created_date: '2026-09-13 16:53'
labels:
  - testing
  - flakiness
dependencies: []
references:
  - packages/virtual-ipod-server/
priority: low
type: bug
ordinal: 291000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`bun run test --force` failed once with:

```
Failed:    @podkit/virtual-ipod-server#test:unit
ERROR  run failed: command  exited (1)
```

**The error text was not captured** — the run's output was being tailed rather than saved, so all that survives is the task-level failure. That is the main thing wrong with this report, and the reason it is filed rather than fixed.

## What was ruled out

- Re-ran that package alone: 9 pass / 0 fail.
- Re-ran the identical full suite (`bun run test --force`, `Cached: 0`): 65/65 successful.
- Ran the package's unit tests 10 consecutive times with 6 host busy loops on 12 cpus: 10 pass / 0 fail.

So it is not deterministic, not obviously load-sensitive, and does not reproduce in isolation. It happened while turbo was running 65 tasks in parallel, which is the condition not reproduced by any of the above.

## Why it is filed at all

It surfaced on the first full run after TASK-506 set `retry = 0` everywhere. Under the previous `retry = 2` this would have been re-run twice and almost certainly reported green — which is the behaviour that task removed on purpose. A flake is a bug report; this one is just a very thin report.

## Next step

Do not hunt it speculatively. When it recurs, capture the whole run (`bun run test --force > run.log 2>&1`) and work from the message. If it never recurs, close this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A recurrence is captured with the actual failing test and its error output, or the task is closed as not-recurring with the number of clean full runs since
- [ ] #2 If reproduced, the cause is identified rather than absorbed by a retry or a widened timeout
<!-- AC:END -->
