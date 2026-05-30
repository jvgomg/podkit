---
id: TASK-359.02
title: Remove silent-pass guards and swallowed-error probes in e2e tests
status: Done
assignee:
  - claude
created_date: '2026-05-28 21:27'
updated_date: '2026-05-30 15:31'
labels:
  - testing
  - e2e
  - test-quality
dependencies: []
references:
  - agents/testing.md
  - test-packages/e2e-tests/src/features/upgrades.test.ts
  - test-packages/e2e-tests/src/commands/video-sync.test.ts
parent_task_id: TASK-359
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Several e2e tests wrap their assertions in conditionals or swallow probe errors, so missing/broken data reads as a pass instead of failing loudly — the silent-skip anti-pattern (agents/testing.md). Make the data presence an assertion, and let probes throw.

Sites:
- `if (json?.plan) { …expect… }` guarding whole blocks → assert `plan` is defined first: `features/upgrades.test.ts` (163, 222, 301, 373, 439, 455), `features/preset-change.test.ts:168`.
- `if (dims)` / `if (existsSync(file))` skipping the real assertion: `features/mass-storage-sync.test.ts` (339 artwork-resize cap, 421 idempotency mtime, 1298/1425/1543/1685 empty-dir tolerance).
- try/catch returning false/null in probe helpers → degrades to "no artwork"/"not a dir": `features/file-mode.test.ts:71-83`, `features/upgrades.test.ts:529`, `features/mass-storage-sync.test.ts:164-211`.
- `if (videos.length === 0) { console.log('Skipping'); return; }` silent skips: `commands/video-sync.test.ts` (252-256, 281-285, 311-315, 341-345) — these should `ensureFixturesExist`/`requireX` at module load instead.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Assertion-guarding `if` conditions replaced with a definedness/existence assertion that fails when data is missing
- [x] #2 Probe helpers no longer swallow errors into a falsy default — a broken probe fails the test
- [x] #3 video-sync silent early-returns replaced with module-load fixture preflight
- [x] #4 Full e2e suite still green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reference pattern (already in tree as of TASK-358.01): the artwork-matrix observers (`test-packages/e2e-tests/src/matrix/artwork-rules.ts` `observeStaticArtwork`) assert `result.failed === expectedFailures` (default 0) and `dryJson.result.failed === 0` exactly, instead of tolerating any partial-failure. Sites listed above should mirror that style — an `if (data) { expect... }` becomes `expect(data).toBeDefined(); expect(data!.x)...`. Probe try/catch returning falsy is the same anti-pattern — let it throw and the test fails with a real reason.

2026-05-30 (Claude): Worked through the 4 fix buckets:

1. **Plan guards** (upgrades.test.ts × 6, preset-change.test.ts × 1): the 5 sites in upgrades.test.ts that ran against **non-dry-run** sync output were hollow — `plan` is undefined for real syncs, so the original `if (json?.plan)` always-skipped. First attempt (expect-defined on the plan) made them fail loudly, which surfaced the hollow contract. Converted to `result.completed` assertions instead (result IS populated on real syncs): `completed > 0` for detect+apply tests, `completed === 0` for idempotency tests. The one dry-run site in upgrades.test.ts and the preset-change.test.ts site retained the expect-defined-plan style because plan IS populated under --dry-run.

2. **Mass-storage probe helpers** (getArtworkPixFmt, hasEmbeddedArtwork, getArtworkDimensions): removed try/catch returning falsy; let ffprobe throw. Docblocks clarify ffprobe exits 0 on streamless files so callers asserting === false won't see a spurious throw.

3. **Mass-storage if-skips** inside tests: `if (dims)` → `expect(dims).not.toBeNull()`, `if (existsSync(file))` mtime check → assert file exists. Four empty-dir tolerance sites converted from `if (existsSync) expect(empty)` to `const remaining = existsSync ? await readdir : []; expect(length).toBe(0)` — same tolerance, but a non-empty surviving dir fails loudly instead of being silently OK along the missing-dir branch.

4. **upgrades.test.ts findIpodMusicFiles** try/catch: rewrote to use `readdir({ withFileTypes: true })` + `.isDirectory()` filter instead of relying on try/catch around readdir-of-file. file-mode.test.ts hasEmbeddedArtwork: removed try/catch, let throw, with same ffprobe-exits-0 clarifying comment.

5. **video-sync.test.ts silent early-returns**: 4 sites doing `if (X.length === 0) return` against a static Videos const catalogue (4 passthrough, 2 transcode, 1 movie, 1 tvshow). Replaced with exact-count assertions (sonnet review recommendation — turns the guard into a regression detector for the catalogue itself).

Sonnet review of the diff (pre-commit) caught two improvements: (a) clarify the ffprobe-exits-0 contract on probe docblocks for callers asserting `=== false`, (b) tighten the video-sync expects from `> 0` to exact counts. Both applied.

Real-world bug surfaced (not fixed in this task): the 4 hollow plan-guard tests had been silently asserting nothing for an unknown period. Detect+apply tests now properly verify operations ran; idempotency tests now properly verify zero work was done. Track-count assertions were already in place.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Removed silent-pass guards and swallowed-error probes per the task spec. The diff covers 5 e2e test files and one helper rewrite. Tests now fail loudly when missing data would previously have produced a green silent skip.

## Major change classes

- **Plan guards → result assertions** (`upgrades.test.ts`): the original `if (json?.plan) { … }` was always-false on **non-dry-run** sync output (plan is only populated for `--dry-run`). The wrapped assertions never ran. Converted to `result.completed` checks (which IS in non-dry-run output) — `> 0` for detect+apply tests, `=== 0` for idempotency. The one dry-run-style site retained `expect(plan).toBeDefined()`. Same treatment on `preset-change.test.ts:168` (genuinely a dry-run).
- **Probe try/catch removed** (`mass-storage-sync.test.ts` × 3 helpers, `file-mode.test.ts` × 1): probes no longer swallow ffprobe failures into a falsy "no artwork" default. Docblocks note ffprobe exits 0 on streamless files so callers asserting `=== false` are safe.
- **if-skips → asserts** (`mass-storage-sync.test.ts`): `if (dims)` and `if (existsSync(file))` skips became explicit `expect(…).not.toBeNull()` / `expect(existsSync(…)).toBe(true)`. The four empty-dir tolerance sites became `const remaining = existsSync ? await readdir : []; expect(length).toBe(0)` — preserves the deliberate either-pruned-or-empty contract but asserts it as a single boolean instead of skipping the missing-dir branch silently.
- **try/catch readdir** (`upgrades.test.ts findIpodMusicFiles`): rewrote with `readdir({ withFileTypes: true })` + `.isDirectory()` filter; unreadable subdirs now throw instead of being swallowed.
- **Silent early-returns** (`video-sync.test.ts` × 4): static `Videos` catalogue means `getMovies()` etc. always return >0 entries. Replaced `if (X.length === 0) return` with exact-count assertions (`.toBe(4/2/1/1)`) — regression detector for the catalogue.

## Tests

- `bun run typecheck --filter @podkit/e2e-tests` ✓
- `bunx oxlint` on all 5 touched files ✓
- `bun run test:e2e` → 31 pass / 0 fail (505s)
- `bun run test:e2e:docker` → 4 pass / 0 fail (227s)

## Bug surfaced (not fixed here)

The plan-guard sites in upgrades.test.ts had been silently asserting nothing for an unknown period because `plan` is only present on dry-runs. The bug-fix-via-test-tightening: the tests now use `result.completed` which is the right field for non-dry-run output. Track-count assertions on the device side were already in place, so the meaning of each test is preserved and now actually checked.

## Review process

Pre-commit sonnet review caught two improvements: (a) clarify ffprobe-exits-0 contract in probe docblocks (saves a reader worry about `=== false` callers), (b) tighten video-sync expects from `> 0` to exact counts. Both applied before the e2e run.
<!-- SECTION:FINAL_SUMMARY:END -->
