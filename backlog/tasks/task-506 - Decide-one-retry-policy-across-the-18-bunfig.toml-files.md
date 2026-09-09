---
id: TASK-506
title: Decide one retry policy across the 18 bunfig.toml files
status: To Do
assignee: []
created_date: '2026-09-09 20:25'
updated_date: '2026-09-09 22:22'
labels:
  - testing
  - flakiness
dependencies:
  - TASK-500
  - TASK-504
  - TASK-505
  - TASK-507
references:
  - docs/agents/testing.md
  - docs/architecture/testing/taxonomy.md
priority: medium
type: chore
ordinal: 285000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Do this last.** It depends on the underlying flake causes being fixed first — see the sequencing note at the bottom.

Eighteen `bunfig.toml` files carry three different retry policies, and there is no recorded reason for the spread:

- `retry = 2` — fourteen packages
- `retry = 1` — both e2e packages (`e2e-tests`, `e2e-vm-tests`)
- **nothing at all** — `test-packages/lima`

## Retry is not neutral. It changes the diagnosis, in both directions.

**It made a deterministic failure look flaky.** `47fae11c`: a unit test read fixtures that turbo never generated for `test:unit`, so it failed 100% of the time on a fresh clone — and the commit records that *"bunfig's `retry = 2` masked it as a flake ('attempt 3')"*. Someone had to notice the failure was identical all three times to see it wasn't a flake at all.

**It manufactured a worse failure than the one it was hiding.** `cdee74e5`: RTL renders leaked into happy-dom's process-global document, so *"with bunfig retry=2 that turned any single flaky failure into a guaranteed 3-for-3 cascade ('Found multiple elements with the text …')"*. Retry converted an intermittent failure into a deterministic one **with a different error message**, pointing away from the real cause.

**It did nothing for the case that mattered most.** task-501's exit-254 failure happened at the sync level, beneath bun's retry, so `retry = 1` never engaged.

And `test-packages/lima` having no retry is why the heartbeat flake (`a6964fcd`) took a CI run down outright instead of being silently absorbed — arguably the correct outcome, and reached by accident.

## What to decide

Not "what number" but **what retry is for here**. Two coherent positions:

- **Retry is a lie detector's blind spot — remove it.** A flaky test is a bug; hiding it defers the bug and, per the two commits above, distorts it. The cost is a redder CI while real flakes remain.
- **Retry is a shock absorber for genuinely non-deterministic infrastructure** (container startup, VM enumeration, network) and should apply *only* where that is true — which is the e2e/VM packages, not pure unit tests, which is close to the inverse of today's spread.

Whichever is chosen, the reasoning belongs in `docs/agents/testing.md` next to the taxonomy, because the current arrangement reads as considered and is not.

Also worth settling: whether a retried-then-passed test should be **visible**. Today a green job can hide a failure-then-pass entirely — the task-501 stress waves had to be checked for it explicitly, by grepping twelve job logs for retry lines, which is not a thing anyone will do routinely.

## Sequencing

**Blocked on the real causes landing first (task-500, task-504, task-505).** Lowering retry while genuine flakes remain turns CI red for reasons unrelated to this decision, and changing it earlier alters the failure surface every one of those tasks is trying to observe.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single stated position on what retry is for in this repo, recorded in docs/agents/testing.md rather than only in bunfig files
- [ ] #2 Every bunfig.toml either matches that policy or documents in-file why it is an exception
- [ ] #3 test-packages/lima's absent retry is confirmed deliberate or corrected — it is currently the only package with no setting and nothing says whether that is intent
- [ ] #4 A decision is recorded on whether a retried-then-passed test must be visible in CI output, and if so it is made visible
- [ ] #5 The two documented failure modes (retry masking a deterministic failure; retry cascading leaked state into a different error) are captured in the guidance so the next reader does not rediscover them from commit messages
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: Claude Opus 5
created: 2026-09-09 22:22
---
**Evidence gathered before deciding: retry is load-bearing today, and that is the argument for fixing rather than keeping it.**

Grepped the job logs of the three most recent green `main` CI runs (`34406697529`, `34402727980`, `34401036068`) for attempt markers. Retry fires on **every one of them**:

- `templates.integration.test.ts` — `createTestIpod() ... uses fast path` at **attempt 2**, logged at 47ms against a `< 50ms` bound.
- `device.integration.test.ts` — `shows track count correctly` at **attempt 3**, i.e. it failed twice.

So the answer to "is retry doing anything?" is yes, and switching it off today turns CI red immediately. Both are now **task-507**, which this task depends on.

Two things that sharpen the decision:

1. **The flakes are in *integration*, not e2e.** The 12 e2e stress samples run under task-501 had zero retry firings. The packages where retry is actually firing are the ones with the weakest case for having it — by the repo's own taxonomy, unit and integration are in-process with no external deps, so nondeterminism there is a defect rather than a fact of life.

2. **The escalation path is the real cost, not the hiding.** `de6e5bf8` is what happens when retry *fails* to absorb something: the response was `describe.skipIf`, and `lossy-preserve-efficiency`'s assertion then ran on no Linux host and no CI run at all until task-500 found it. Retry normalises "tests sometimes fail"; skip is the next step when retry is not enough. Each step is locally reasonable and the sequence ends with no coverage.

Suggested shape for the decision, given the above: `retry = 0` for unit and integration (16 of 18 packages) once task-507 lands; a considered value only where genuinely nondeterministic infrastructure is involved, with a bounded wait at the flaky *step* preferred over a re-run of the whole test — which is what task-505 did across 15 files and what `d14e9d0d` did correctly by retrying at the apt level rather than the test level.
---
<!-- COMMENTS:END -->
