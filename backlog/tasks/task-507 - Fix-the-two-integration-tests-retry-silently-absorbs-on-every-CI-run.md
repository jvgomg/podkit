---
id: TASK-507
title: Fix the two integration tests retry silently absorbs on every CI run
status: Done
assignee: []
created_date: '2026-09-09 22:21'
updated_date: '2026-09-09 23:59'
labels:
  - testing
  - flakiness
dependencies: []
references:
  - test-packages/gpod-testing/src/templates.integration.test.ts
  - packages/podkit-cli/src/commands/device.integration.test.ts
  - docs/agents/testing.md
priority: high
type: bug
ordinal: 286000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by grepping CI job logs for retry markers, which is not something anyone does routinely — and that is the point. **Both of these fail on essentially every CI run and every run is green.**

Observed in runs `34406697529`, `34402727980`, `34401036068` (all green):

```
(pass) template fast-path > createTestIpod() with defaults uses fast path
       (well under subprocess cost) (attempt 2) [47.00ms]
(pass) device info integration > shows track count correctly (attempt 3) [4.00ms]
```

## 1. `templates.integration.test.ts:24` — a timing proxy for a code path

```ts
const start = performance.now();
const ipod = await createTestIpod();
const ms = performance.now() - start;
// Subprocess spawn alone is ~250-300ms. Template copy is ~5ms. 50ms is a
// generous separator that proves the fast path was taken.
expect(ms).toBeLessThan(50);
```

Logged at **47ms** against a 50ms bound. The comment states the intent exactly: it wants to prove *which path ran*, and uses elapsed wall-clock as the proxy. On a loaded 4-vCPU runner a 5ms copy takes 47ms while the fast path is working perfectly, so the proxy breaks and the thing it stands for does not.

**Raising the bound is the wrong fix** — it weakens the only thing the test asserts and the next loaded runner beats it again. Assert the path directly: whether the template cache was hit, or that no subprocess was spawned. `PODKIT_DISABLE_TEMPLATE_CACHE` already exists as a seam and the test is gated on it, so the codebase can already tell the two paths apart somewhere.

## 2. `device.integration.test.ts:123` — reaches attempt 3

Failed **twice** before passing, so this is not a marginal wobble. It adds three tracks via `withTestIpod`, then opens the database and asserts `trackCount === 3`.

Note it calls `createDeviceContext(ipod.path, { json: true })` and never uses the result — the assertion goes through `IpodDatabase.open` directly. Worth establishing whether that line is vestigial or whether it is doing something load-bearing by side effect.

**Do not make this pass. Find out why it fails.** A count that is wrong twice and right once points at write visibility or shared state, and either could be a real defect in `@podkit/core` rather than a test problem — which is exactly what task-501 turned out to be.

## The shared-template-cache hypothesis

Both tests go through `createTestIpod` / `withTestIpod`, which share a cached iPod template, and `PODKIT_DISABLE_TEMPLATE_CACHE` exists as an escape hatch — implying the cache has caused trouble before. A shared directory read and written by concurrent test processes is the same shape as task-501's failure.

This is a lead, not a finding. Confirm or discard it explicitly rather than assuming it.

## Why this blocks the retry decision

task-506 asks whether retry should be off. It cannot be answered while these two are live: switching retry off today turns CI red on them immediately. Fix these, and the case for `retry = 0` on unit and integration becomes straightforward.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The cause of each failure is identified and stated — not merely a change that makes them pass
- [x] #2 The `< 50ms` assertion is replaced by one on the code path actually taken, so a loaded runner cannot fail it while the fast path works
- [x] #3 The device-info failure's cause is established as a test defect or a product defect, and if it is a product defect it is filed separately with the evidence
- [x] #4 The shared-template-cache hypothesis is confirmed or discarded, with the reasoning recorded
- [x] #5 Each fix is shown to hold under adverse conditions — repeated runs under induced load with retry disabled, not a single green pass
- [x] #6 Whether the unused `createDeviceContext` call in the device test is load-bearing is established, and it is removed if it is not
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Causes

**Both are test-infrastructure defects. Neither is a product defect, and neither involves the template cache.**

### 1. `templates.integration.test.ts` — the description was right

`expect(ms).toBeLessThan(50)` is a wall-clock proxy for a branch. The CI log
(run 34406697529, line 4086) shows attempt 1 at **68.53 ms** and attempt 2 at
47 ms — the template fast path was taken and working both times. On a loaded
4-vCPU runner a 5 ms `fs.cp` of a 61-directory tree is simply not separable
from a 300 ms subprocess spawn by duration.

### 2. `device.integration.test.ts:123` — the description was wrong

**The `trackCount` assertion never ran and has never failed.** The real failure,
from the same CI log (lines 8635-8645), is:

```
killed 1 dangling process
GpodToolError: Failed to parse gpod-tool output: add-tracks /tmp/test-ipod-qiAGKn
  exitCode: 143,
   stderr: "",
      at addTracks (…/gpod-testing/dist/index.js:204:11)
```

`143` is `128 + SIGTERM`. The chain:

1. The test body (template copy → `gpod-tool add-tracks` subprocess → native
   `IpodDatabase.open`) overruns the per-test timeout.
2. `bun test` abandons the test and its auto-killer SIGTERMs the still-running
   `gpod-tool` child — that is the `killed 1 dangling process` line.
3. The child dies with empty stdout, so `addTracks` throws a *parse* error.
4. Because the rejection can land after the test was abandoned, bun reports it
   as `# Unhandled error between tests` and attributes it to whichever test
   reports next — so the failing test name is often not the slow one.

**Why it overran: bun's default 5000 ms timeout applied.** `TEST_TIMEOUT`
(30000 default, 120000 in CI) is honoured only by `gpod-tests-parallel`
(podkit-core, libgpod-node). The three packages that call `bun test` directly
for integration — `podkit`, `@podkit/gpod-testing`, `@podkit/ipod-archive` —
silently inherited 5000 ms. That is exactly why the only two tests reaching
retry in CI live in two of those three packages. `docs/agents/testing.md:833`
already documented `TEST_TIMEOUT=60000 bun run test:integration` as working; it
did not.

Measured (4 cores, ~7x oversubscribed, `--timeout 300000` so nothing is
truncated): these testcases run at ~0.2 s median with observed outliers of
**3.0 s, 4.9 s, 13.4 s and 35.2 s**. They *complete* — this is CPU starvation
with a fat tail, not a hang. 5000 ms sits inside that tail. A standalone probe
of `add-tracks` alone (200 samples under the same load) never exceeded 265 ms,
so the tail comes from the whole test process being starved, not from the
subprocess.

## Template-cache hypothesis: **discarded**

- `PODKIT_DISABLE_TEMPLATE_CACHE` was introduced by `328ddb65` (TASK-227) in the
  same commit that added templates, purely as the A/B switch used to measure the
  3.3x speedup. It is not a workaround for a cache bug — see task-227's notes.
- The template directory is **read-only at test time**. `createTestIpod` only
  ever `fs.cp`s *out* of it into a private `mkdtemp` dir. Its only writer is the
  `generate-templates` turbo task, which is a declared dependency of every
  consuming test task and so never runs concurrently with them.
- Neither failure touched it: #1 failed a timing bound while the cache worked;
  #2 failed on a SIGTERMed subprocess.

## Fixes

1. `TestIpod` now reports **`usedTemplate: boolean`** — the branch indicator
   itself, not a proxy. The timing test asserts `usedTemplate === true`. A new
   companion test sets `PODKIT_DISABLE_TEMPLATE_CACHE=1` and asserts
   `usedTemplate === false` + a valid database, so the flag must be able to
   report both and cannot decay into a constant.
2. `test:integration` in `podkit`, `@podkit/gpod-testing` and
   `@podkit/ipod-archive` now pass `--timeout ${TEST_TIMEOUT:-30000}`, matching
   what `gpod-tests-parallel` has always done. No new number was invented; CI's
   existing `TEST_TIMEOUT: 120000` now actually reaches these packages.
3. `gpod-tool.ts` names the signal instead of reporting a parse failure:
   `gpod-tool add-tracks /tmp/… was killed by SIGTERM before writing output
   (exit 143) — the caller was most likely abandoned mid-run, e.g. by a
   bun:test timeout reaping its dangling child`.
4. `createDeviceContext` was **vestigial** — no CLI command is invoked anywhere
   in `device.integration.test.ts`; it imports only `IpodDatabase` and friends
   from `@podkit/core`. Its sole effect was leaving a module-global CLI context
   set between tests. Removed, along with `createTestContext`, all 33 call
   sites, the eight `afterEach(clearContext)` blocks and the now-unused imports
   (−193 lines).
5. `docs/agents/testing.md`: new "A duration is never a proxy for a code path"
   rule next to the sleeps section, a `TEST_TIMEOUT` section documenting the
   watchdog and the SIGTERM signature, and a `usedTemplate` note in the
   Template Fast-Path section.

## Reproduction rates (retry disabled, induced CPU load, 4 cores)

Reproduced the exact CI signature naturally, and deterministically via
`--timeout 30` (identical output: `killed 1 dangling process`, `exitCode: 143`,
`# Unhandled error between tests`).

| Arm | Failures |
|---|---|
| templates, old `< 50 ms` bound (~27x oversubscribed) | **3 / 60** |
| templates, new `usedTemplate` assertion (same load) | **0 / 60** |
| device file, `--timeout 5000` (pre-fix, ~27x) | **3 / 60** |
| device file, `--timeout 30000` (post-fix local default, ~27x) | **1 / 60** |
| device file, `--timeout 5000` (pre-fix, ~16x) | **1 / 50** |
| device file, `--timeout 120000` (CI value, ~16x) | **0 / 50** |

The one post-fix failure at 30000 ms was under ~27x oversubscription — roughly
9x worse than CI's ~3x — and its log confirms the same timeout chain. At CI's
`TEST_TIMEOUT=120000` the arm is clean. The captured pre-fix failure shows
`(fail) … (attempt 3) [5004.07ms]`: the 5000 ms default, to the millisecond.

## Verification

- `bun run lint` clean; `bunx turbo run typecheck` 38/38; `bunx prettier
  --check` clean on every touched file.
- `bunx turbo run test --force --filter @podkit/gpod-testing --filter podkit
  --filter @podkit/ipod-archive` → 24/24, **Cached: 0**.
- `bun run test` (full unit + integration) → 65/65 green.
- No changeset: nothing user-facing changed in a distributed package (the two
  `packages/` edits are a test script and a test file).

## Note for TASK-506

Neither of these needed `retry` to be green, so `retry = 0` on unit and
integration is now unblocked. Worth knowing before that decision: bun's
"unhandled error between tests" attributes a leaked rejection to an unrelated
test, so with retry off the *named* failing test may not be the one at fault.
<!-- SECTION:NOTES:END -->
