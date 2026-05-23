---
id: TASK-352
title: >-
  Wire initialContent seeding in backing-file synthesiser (unblocks
  populated/corrupt-db Tier-3)
status: To Do
assignee: []
created_date: '2026-05-23 18:19'
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
- [ ] #1 lima-test-vm-backing-files.ts copies initialContent fixtures into FAT32 image after mkfs.vfat
- [ ] #2 mtools added to test-vm.yaml apt install list
- [ ] #3 echo-mini-populated backing image contains 5 mocked track files at expected paths
- [ ] #4 ipod-video-5g-corrupt-db backing image contains corrupt iTunesDB at iPod_Control/iTunes/iTunesDB
- [ ] #5 Tier-3 test verifies seeded files via mount + ls + sha256
- [ ] #6 Tier-3 baseline remains GREEN
<!-- AC:END -->
