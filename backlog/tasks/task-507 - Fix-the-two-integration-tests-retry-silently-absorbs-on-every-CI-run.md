---
id: TASK-507
title: Fix the two integration tests retry silently absorbs on every CI run
status: To Do
assignee: []
created_date: '2026-09-09 22:21'
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
- [ ] #1 The cause of each failure is identified and stated — not merely a change that makes them pass
- [ ] #2 The `< 50ms` assertion is replaced by one on the code path actually taken, so a loaded runner cannot fail it while the fast path works
- [ ] #3 The device-info failure's cause is established as a test defect or a product defect, and if it is a product defect it is filed separately with the evidence
- [ ] #4 The shared-template-cache hypothesis is confirmed or discarded, with the reasoning recorded
- [ ] #5 Each fix is shown to hold under adverse conditions — repeated runs under induced load with retry disabled, not a single green pass
- [ ] #6 Whether the unused `createDeviceContext` call in the device test is load-bearing is established, and it is removed if it is not
<!-- AC:END -->
