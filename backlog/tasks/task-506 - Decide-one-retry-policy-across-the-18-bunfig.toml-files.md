---
id: TASK-506
title: Decide one retry policy across the 18 bunfig.toml files
status: To Do
assignee: []
created_date: '2026-09-09 20:25'
labels:
  - testing
  - flakiness
dependencies:
  - TASK-500
  - TASK-504
  - TASK-505
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
