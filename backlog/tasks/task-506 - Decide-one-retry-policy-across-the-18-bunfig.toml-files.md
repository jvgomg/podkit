---
id: TASK-506
title: Decide one retry policy across the 18 bunfig.toml files
status: Done
assignee: []
created_date: '2026-09-09 20:25'
updated_date: '2026-09-13 16:06'
labels:
  - testing
  - flakiness
dependencies:
  - TASK-500
  - TASK-504
  - TASK-505
  - TASK-507
  - TASK-508
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
- [x] #1 A single stated position on what retry is for in this repo, recorded in docs/agents/testing.md rather than only in bunfig files
- [x] #2 Every bunfig.toml either matches that policy or documents in-file why it is an exception
- [x] #3 test-packages/lima's absent retry is confirmed deliberate or corrected — it is currently the only package with no setting and nothing says whether that is intent
- [x] #4 A decision is recorded on whether a retried-then-passed test must be visible in CI output, and if so it is made visible
- [x] #5 The two documented failure modes (retry masking a deterministic failure; retry cascading leaked state into a different error) are captured in the guidance so the next reader does not rediscover them from commit messages
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Decision: `retry = 0` repo-wide, explicit in all 18 bunfig.toml files, with the reasoning and the exception process in docs/agents/testing.md, and a lint-wired guard so the spread cannot silently reassemble.

1. Record the position in `docs/agents/testing.md` (new §Retries) — the three historical failure modes, the `beforeAll` finding, the visibility decision, how to grant an exception.
2. `retry = 0` in all 18 files, each carrying a short pointer comment; `test-packages/lima`'s absent setting becomes explicit.
3. `scripts/check-test-retry-policy.mjs`, wired into `bun run lint`: fails on any non-zero retry without a `# retry-exception: <reason>` comment, and on an absent setting.
4. Verify with caches forced: unit + integration, host e2e, and the VM suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decision

**`retry = 0` in every `bunfig.toml`.** A test that passes on the second attempt is a bug report, not a pass. Recorded in `docs/agents/testing.md` §"Retries: there are none, and that is the policy" — the position, the three historical failure modes, the exception process, and the visibility finding.

This went further than the shape suggested in comment #1 (`retry = 0` for unit + integration, a considered value for the e2e/VM packages). One finding killed the carve-out.

## Why the e2e/VM carve-out did not survive

**A `beforeAll` failure is not retried.** Verified against bun 1.3.13 with a suite whose `beforeAll` throws on its first call and would succeed on its second: under `retry = 2` it fails outright, reported as `(fail) <suite> > (unnamed)`.

That is exactly where the VM lane's flakes live. TASK-510's synthesis flake surfaced as `VM: starter personas > (unnamed)` in a package that had `retry = 2` set, and the retry did nothing — the work happens in `prepare()`, inside a hook. So retry in the e2e/VM packages was never the shock absorber it looked like: it covered the in-test assertions, which are the deterministic part, and not the infrastructure setup, which is the part that actually flakes.

The carve-out would have preserved a setting that cannot fire where it was wanted.

## AC #4 — visibility

Decision: a retried-then-passed test must never be silent, which under `retry = 0` cannot arise. The reasoning is recorded anyway because the failure mode is invisible by default and anyone granting an exception needs it.

Measured: **bun 1.3.13 prints no attempt marker.** A test that fails twice then passes dumps two full error blocks into the log and ends with `2 pass / 0 fail` — a green summary with errors above it, and nobody reads upward from a green summary. This is worse than comment #1 assumed; the old CI logs' "attempt N" text is not something this bun version emits.

The machine-readable escape hatch is the JUnit reporter, which records **every attempt as its own `<testcase>`**: the retried test appears as duplicate entries with `<failure>` children followed by a clean one, and the suite `tests=`/`failures=` counts exceed the real test count (measured: `tests="4" failures="2"` for 2 real tests, one retried twice). Any exception must be run that way and surface the duplicates.

## AC #3 — `test-packages/lima`

Corrected, not blessed. It now says `retry = 0` explicitly. Its absent setting was the only one in the repo and nothing recorded whether that was intent; the guard below now rejects an absent setting for that reason.

## Enforcement

`scripts/check-test-retry-policy.mjs`, wired into `bun run lint`. Fails on a non-zero `retry` without a `# retry-exception: <reason>` comment directly above it, and on an absent setting. Exceptions are reported by name on success so they stay visible rather than accumulating quietly.

Verified in all four directions: the pre-change tree produced 18 violations; a reinstated `retry = 2` is rejected; a genuine `# retry-exception:` is accepted and named; and prose that merely contains the phrase (`# note: this is not a retry-exception: style comment`) is still rejected.

## Verification, all with caches forced

| Lane | Result |
|------|--------|
| `test:unit` + `test:integration` | 48/48 tasks, `Cached: 0` |
| `bun run test` (full) | 65/65 tasks, `Cached: 0` |
| `test:e2e` (host binary) | 36 passed, 1 failed — the failure is TASK-511, see below |
| `test:vm` | 38 + 238 tests green ×3 (one idle, two under host load) |
| `bun run lint` / `typecheck` | clean / 38–38 |

## The one red test, and what it is not

`test:e2e` has one failure on macOS: `lossy-preserve-efficiency.test.ts`, `expect(preserveBitrate).toBeGreaterThan(convertBitrate)` with both at 67.

**It is not caused by this change and was not being hidden by retry.** It fails identically with the old `retry = 1` restored — 12 failures in 13 runs, deterministic at 67 vs 67. An early single observation of a pass led me to report the opposite for a few minutes; three runs on the stashed tree corrected it.

The cause is in the product: on macOS `aac_at` is the top-priority encoder and `aacAtQualityFromBitrate` maps a target onto five rungs, so the test's two targets (~92 and ~69 kbps) both emit `-q:a 8` — identical encoder arguments, identical output. Filed as **TASK-511**, which also asks whether upward rung rounding can push output past a quality cap.

## Also landed here

TASK-510's cause, which this task's first forced VM run exposed once the enumeration lane was quiet: `mkfs.vfat: unable to open /dev/loop0p1: No such file or directory`. Fixed with a bounded wait for the partscan node — the "bounded wait at the flaky step" the new policy prescribes, and its first application.
<!-- SECTION:NOTES:END -->

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

author: Claude Opus 5
created: 2026-09-12 13:48
---
**Dependency added: TASK-508.**

TASK-504 has landed and is Done, so its half of the sequencing is satisfied. But its VM-side confirmation could not be run on the Linux dev box (no `/dev/kvm`; the device VM is `vmType: 'vz'`, macOS-only) and was split out into TASK-508.

Adding TASK-508 here rather than treating TASK-504/Done as sufficient, because this task's own sequencing note asks for the real causes to have *landed* before retry changes — and for the VM surface, "landed" is not yet "shown to hold". Turning `retry = 0` on while the VM suite's enumeration guarantee is unconfirmed would change the failure surface and the evidence at the same time, which is the thing the sequencing note exists to prevent.

Everything else this task was waiting on is now done: 500, 505 and 507 are complete, and 507's notes record that neither of the two integration flakes needed retry to be green.
---
<!-- COMMENTS:END -->
