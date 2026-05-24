---
id: TASK-352
title: >-
  Wire initialContent seeding in backing-file synthesiser (unblocks
  populated/corrupt-db Tier-3)
status: Done
assignee: []
created_date: '2026-05-23 18:19'
updated_date: '2026-05-24 09:25'
labels:
  - vm-testing
  - tier-3
  - infrastructure
  - follow-up
  - fixtures
milestone: m-19
dependencies: []
priority: low
ordinal: 10300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`packages/device-testing/src/personas/types.ts` defines `synthesis.initialContent: Array<{path, sourceFixture}>` for seeding files into FAT32 backing images after `mkfs.vfat`. The runner (`packages/device-testing/src/runners/lima-test-vm-backing-files.ts`) currently ignores this field.

Two personas declare `initialContent` but get empty FAT32 backing at Tier-3 runtime today:
- `echo-mini-populated` — 5 × 64-byte mocked tracks in `Music/`
- `ipod-video-5g-corrupt-db` — 512-byte corrupt iTunesDB at `iPod_Control/iTunes/iTunesDB`

Tier-1 smoke tests pass (recipe shape + direct parser calls). Tier-3 tests against these personas see an empty FAT32.

## Scope

1. Extend `ensureBackingFile` in `lima-test-vm-backing-files.ts`: after `mkfs.vfat`, if `synthesis.initialContent` non-empty, copy fixtures into image via `mtools` (`mcopy`)
2. Add `mtools` to `tools/device-testing/lima/test-vm.yaml` apt list
3. Verify: build `echo-mini-populated` backing in VM, mount image, confirm 5 tracks present
4. Verify: same for `ipod-video-5g-corrupt-db` (iTunesDB binary at correct path)
5. Add Tier-3 test asserting seeded files via mount + ls + sha256

## References
- `packages/device-testing/src/personas/types.ts` — `initialContent` schema
- `packages/device-testing/src/personas/echo-mini-populated/persona.ts` — first consumer
- `packages/device-testing/src/personas/ipod-video-5g-corrupt-db/persona.ts` — second consumer
- TASK-324 PR-review flag #1 — source of this finding
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 lima-test-vm-backing-files.ts copies initialContent fixtures into FAT32 image after mkfs.vfat
- [x] #2 mtools added to test-vm.yaml apt install list
- [x] #3 echo-mini-populated backing image contains 5 mocked track files at expected paths
- [x] #4 ipod-video-5g-corrupt-db backing image contains corrupt iTunesDB at iPod_Control/iTunes/iTunesDB
- [x] #5 Tier-3 test verifies seeded files via mount + ls + sha256
- [x] #6 Tier-3 baseline remains GREEN
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Wired `synthesis.initialContent` into `ensureBackingFile` via mtools (`mmd` + `mcopy`) between `mkfs.vfat` and the atomic `mv`. `mtools` added to `test-vm.yaml` apt list.

Determinism: exports `SOURCE_DATE_EPOCH=1700000000` + `MTOOLS_SKIP_CHECK=1` for every mtools call. mkfs.vfat --invariant + fixed SDE = byte-stable sha256 across runs (verified by a determinism `it` in the Tier-3 suite).

Validation up front in `resolveSeedEntries`: rejects `..` segments + leading `/`, requires `/^[A-Za-z0-9_./-]+$/` for in-image paths, stat-checks each source fixture, enforces basename uniqueness across entries (collides in the per-persona stage dir otherwise).

Cleanup is two-layer: build script's trailing `rm -rf` covers the success path; an unconditional `finally` block in `ensureBackingFile` covers the failure path (set -e aborts the script before its inline rm).

mcopy flag note: do NOT pass `-b` — that's mtools' *batch* mode (stream cache), which triggers "Streamcache allocation problem" on multi-MiB images. Binary fidelity is the default; CRLF translation is `-t` (opt-in).

Files:
- packages/device-testing/src/runners/lima-test-vm-backing-files.ts
- packages/device-testing/src/personas/ipod-video-5g-corrupt-db/persona.ts (comment refresh)
- packages/device-testing/src/tier3/backing-file-content.tier3.test.ts (new)
- tools/device-testing/lima/test-vm.yaml (mtools)

Verification:
- bun run build: clean
- bun test src/runners/lima-test-vm-backing-files: 18 pass / 0 fail
- Tier-3 (backing-file-content): 3 pass / 0 fail / 15.4s
- Tier-3 baseline (personas-baseline + mass-storage-binding): 10 pass / 0 fail / 36.5s

Review fixes applied this session: clarified stage-dir cleanup comment, added a `finally` block for the failure-path cleanup, removed `|| true` mask on `mmd` (fresh fat32 → mmd should never fail), switched `VM_NAME` to the exported `LIMA_TEST_VM_NAME` constant, stripped a stale task-id reference in test-vm.yaml.
<!-- SECTION:NOTES:END -->
