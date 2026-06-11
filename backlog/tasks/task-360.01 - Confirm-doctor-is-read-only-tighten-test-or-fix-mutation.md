---
id: TASK-360.01
title: Confirm doctor is read-only; tighten test or fix mutation
status: Done
assignee: []
created_date: '2026-05-28 21:28'
updated_date: '2026-06-11 07:42'
labels:
  - doctor
  - libgpod
  - testing
dependencies: []
references:
  - test-packages/e2e-tests/src/commands/doctor.test.ts
  - packages/libgpod-node/src/index.ts
parent_task_id: TASK-360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`commands/doctor.test.ts:211-244` currently accepts both `'skip'` and `'pass'` for the `artwork-rebuild` check on empty/missing ArtworkDB, with a comment that "libgpod may initialise/rewrite an empty ArtworkDB during `IpodDatabase.open()`".

Code audit suggests this is over-cautious:
- `IpodDatabase.open()` → C `itdb_parse()` (read-only per libgpod source).
- `close()` → `itdb_free()` only; no write.
- The `artwork-rebuild` check uses pure-TS `parseArtworkDB`, not libgpod, and gates on `existsSync` + `buffer.length === 0`.
- Doctor's non-repair path never calls `db.save()`.

## Decision

Verify empirically before assuming. Cheap test: SHA-256 hash the ArtworkDB before and after running `podkit doctor` for both scenarios (no file, empty 0-byte file). If hashes match in both cases, the test comments are wrong; tighten. If a hash changes, find the write site and either bypass (swap to `@podkit/ipod-db` parser) or document it as unavoidable libgpod behaviour.

## References

- test-packages/e2e-tests/src/commands/doctor.test.ts:211-244
- packages/libgpod-node/src/database.ts
- packages/libgpod-node/native/gpod_binding.cc (Parse, itdb_parse)
- packages/podkit-core/src/diagnostics/checks/artwork.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Add hash-stability test: capture ArtworkDB SHA-256 before and after `podkit doctor` for the no-file and empty-0-byte scenarios
- [x] #2 If both hashes are stable (expected): tighten `doctor.test.ts:211-244` to a single deterministic status, remove the 'libgpod may rewrite' comments
- [x] #3 If a hash changes: locate the write site (libgpod parse, close, or doctor code) and either bypass (e.g. use `@podkit/ipod-db` pure-TS parser for read-only paths) or document the constraint
- [x] #4 Record the doctor read-only contract in `documents/architecture/` (new doctor doc or extend conventions.md)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation summary (2026-06-09):

**Hash-stability result: STABLE — but the initial code audit had a wrong assumption.**

The audit assumed the dummy iPod target starts with no ArtworkDB. It does not: the `createTestIpod()` template for model MA147 ships with a 944-byte valid-but-empty ArtworkDB (`mhfd` header, 0 image entries). This means:

- The 'no artwork' scenario actually exercises the `parseArtworkDB` + `db.images.length === 0` branch, returning `'pass'` — not `'skip'` as the code audit predicted.
- Doctor does NOT mutate the file — the SHA-256 is identical before and after a run.

**What was tightened:**

1. `'reports healthy for iPod with no artwork'`: `['skip', 'pass']` → `'pass'` (deterministic, with comment explaining the template fixture)
2. `'passes when ArtworkDB exists but has no entries'` (renamed to `'skips when ArtworkDB exists but is 0 bytes'`): `['skip', 'pass']` → `'skip'` (deterministic). The test was manually truncating to 0 bytes, which correctly exercises the `buffer.length === 0` guard.
3. Removed all 'libgpod may rewrite' comments.
4. Added `artworkDbFingerprint()` helper + two new hash-stability tests in a `'doctor read-only contract (ArtworkDB hash stability)'` describe block that assert `before === after`.
5. Added §10 'Doctor's non-repair path is read-only' to `documents/architecture/conventions.md` documenting the full status-mapping decision tree and the empirical confirmation.

**Files changed:**
- `test-packages/e2e-tests/src/commands/doctor.test.ts`
- `documents/architecture/conventions.md`
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Verified empirically: doctor's non-repair path is read-only. SHA-256 of the ArtworkDB is stable across `podkit doctor` runs in all three scenarios (missing file, 0-byte file, valid 944-byte fixture). AC#3 was conditional on the hash changing; since it didn't, no write-site mitigation was needed.

Tightened `doctor.test.ts:211-244` from `['skip','pass']` hedge to deterministic single statuses (`'pass'` for the fixture, `'skip'` for the truncated case) with three hash-stability tests asserting `before === after`. Documented the read-only contract in `documents/architecture/conventions.md` §10 with the full status-decision tree.

Surprise finding: the original test hedge wasn't paranoia about libgpod mutation — it was masking a fixture quirk. The `createTestIpod()` MA147 template ships with a 944-byte valid-but-empty ArtworkDB, so the "no artwork" scenario exercises the parsed-with-zero-images path (`'pass'`), not the missing-file path (`'skip'`). The §6 §10 contract pins this for future readers.

Landed in commit `2331c7c7`.
<!-- SECTION:FINAL_SUMMARY:END -->
