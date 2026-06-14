---
id: TASK-349
title: 'Test VM: HFS+ refusal Tier-3 backing-image synthesis (closes TASK-341 AC #1)'
status: In Progress
assignee: []
created_date: '2026-05-23 15:52'
updated_date: '2026-06-14 11:40'
labels:
  - vm-testing
  - tier-3
  - infrastructure
  - follow-up
milestone: m-19
dependencies: []
priority: low
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-341 AC #1 (HFS+ refusal scenarios) cannot be covered until the test VM can present an HFS+ block device to podkit.

## Original plan (abandoned)

Enable Debian `contrib` + install `hfsprogs` so the runner could shell out to `mkfs.hfsplus` inside the VM (mirroring the FAT32 `mkfs.vfat --invariant` path).

This plan FAILS on arm64: `hfsprogs` is unpackaged on arm64 in bookworm (main / contrib / updates / backports / security). The source-package's `Architecture: amd64 i386 …` clause predates arm64. Apple-Silicon hosts run the device-harness VM as arm64, so an in-VM `mkfs.hfsplus` path is not viable. apt's all-or-nothing transaction also caused `dosfstools` + `mtools` rollback when an `apt-get install` line listing `hfsprogs` failed — silently breaking all FAT32 persona synthesis on freshly provisioned VMs.

## Revised plan (landed)

Build the HFS+ backing image on the HOST via a pure-TypeScript Volume Header writer (Apple TN1150). Output is a sparse file (~4 KiB on-disk for a 32 MiB declared size); `limactl copy` stages it inside the VM. blkid identifies the volume as `hfsplus` from the on-disk magic alone — no kernel module, no userspace tool, no apt repo.

## Scope

1. Pure-TS HFS+ Volume Header writer at `test-packages/device-testing/src/runners/hfsplus-image-writer.ts`.
2. HFS+ branch in `ensureBackingFile` that delegates to the writer + reuses the existing `limactl copy` + `sudo install` machinery.
3. Synthesised persona `ipod-nano-7g-hfsplus` (clone of `ipod-nano-7g-space-gray` with HFS+ backing).
4. Tier-3 test `hfsplus-refusal.e2e.test.ts` covering `device scan` + `device add` + FAT32-sibling regression.
5. Architecture doc update — `documents/architecture/testing/vm-testing.md` §5.6.
6. Revert the failed contrib + hfsprogs apt install from `podkit-device-harness.yaml`.

## References
- `backlog/tasks/task-341 - …md` AC #1 — deferred behaviour now covered.
- TASK-317.12 — HFS+ refusal landed.
- Apple TN1150 — HFS+ Volume Format spec.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pure-TS HFS+ Volume Header writer landed at `test-packages/device-testing/src/runners/hfsplus-image-writer.ts` with unit-test coverage
- [x] #2 `ensureBackingFile` HFS+ branch delegates to the host-side writer + reuses limactl copy machinery; idempotent on sha256 match
- [x] #3 Synthesised persona `ipod-nano-7g-hfsplus` registered + re-exported from `@podkit/device-testing`
- [x] #4 TASK-341 AC #1 Tier-3 tests landed: device scan unsupported envelope, device add UNSUPPORTED_FILESYSTEM_ON_LINUX, FAT32 sibling regression
- [x] #5 Architecture doc `documents/architecture/testing/vm-testing.md` updated (§3 ownership table, §5.6 HFS+ section, §8 references)
- [x] #6 podkit-device-harness.yaml NO LONGER references contrib repo / hfsprogs; FAT32 personas still synthesise correctly in the VM
- [ ] #7 Tier-3 baseline remains GREEN after changes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**2026-06-14 — initial implementation pivoted after VM run revealed hfsprogs unpackaged on arm64.**

## Pivot history

Original plan landed (contrib repo + `apt install hfsprogs`) was applied to `podkit-device-harness.yaml`. On the user's first `harness:destroy && harness:setup` cycle:

- `hfsprogs` had no candidate in arm64 across main / contrib / updates / backports / security (`apt-cache madison hfsprogs` empty)
- apt's transaction semantics rolled back `dosfstools` + `mtools` from the same install line
- FAT32 persona synthesis broke VM-wide; the symptom surfaced as `mkfs.vfat command not found` masked by `>/dev/null 2>&1` → "(no output, exit=1)"

Verified by probing the user VM directly: `dpkg -l dosfstools` showed `un / <none>` (uninstalled), `apt-cache policy hfsprogs` showed `Candidate: (none)`, and `grep "^Package: hfsprogs" /var/lib/apt/lists/*arm64*Packages` returned zero matches across every Debian component.

Manually reinstalled `dosfstools mtools` to restore FAT32 capability + reverted the yaml.

## What landed (revised)

**Pure-TS HFS+ writer** at `test-packages/device-testing/src/runners/hfsplus-image-writer.ts`:
- `buildVolumeHeader(totalBlocks)` writes the 512-byte HFS+ Volume Header (signature 'H+', version 4, blockSize 4096, totalBlocks, freeBlocks).
- `buildMinimalHfsplusImage({sizeMiB})` materialises the full image in memory (unit-test convenience).
- `writeMinimalHfsplusImage(dest, {sizeMiB})` writes a sparse file (`ftruncate` + 512-byte header write at offset 1024). Only ~4 KiB physically on disk for a 32 MiB declared size.

**HFS+ branch in `ensureBackingFile`**: delegates to `synthesiseHfsplusBackingFile(...)`, which:
1. writes the sparse image to `os.tmpdir()`;
2. streams the file through `createHash('sha256')` on the host;
3. probes the VM-side sha256 — early-returns with `wasAlreadyIdentical: true` on match;
4. `mkdir -p` the target dir, `limactl copy` host → VM `/tmp`, `sudo install` to `vmPath`;
5. cleans up the host temp file in `finally`.

**Persona `ipod-nano-7g-hfsplus`** (synthesised; clone of `ipod-nano-7g-space-gray` with HFS+ backing).

**Tier-3 test** at `test-packages/e2e-vm-tests/src/hfsplus-refusal.e2e.test.ts`. The scan-side test reads the unsupported reason from `stages.find(s => s.stage === 'filesystem').details.unsupported` — the scan JSON renderer does NOT emit `readiness.unsupportedReason` for block-device entries (that shape is reserved for USB-only entries); the typed reason rides on the stage details. Caught by Sonnet review pass before commit.

**Architecture doc** `documents/architecture/testing/vm-testing.md`:
- §3 table: separate rows for FAT32-in-VM vs HFS+-on-host synthesis paths
- §4 persona authoring: `ipod-nano-7g-hfsplus` cited as canonical synthesised-sibling example
- new §5.6 documenting the pure-TS writer, the arm64 hfsprogs gap, and the decoupling property the unit suite locks down
- §8 references: writer source + filesystem-policy source

**Yaml**: contrib enable / hfsprogs install / mkfs.hfsplus verification all reverted. Added a comment block explaining the HOST-side HFS+ path so future readers don't try to re-add hfsprogs.

## Verification

- Unit: 32 new tests across `hfsplus-image-writer.test.ts` + `lima-test-vm-backing-files.test.ts` HFS+ branch coverage. 166/166 device-testing unit tests GREEN.
- Typecheck + lint: clean across `@podkit/device-testing`, `@podkit/e2e-vm-tests`, `@podkit/core`.
- VM Tier-3: gated on a fresh `harness:destroy && harness:setup` cycle to pick up the reverted yaml (so FAT32 synthesis is restored). Once the user re-provisions, `bun run test:vm hfsplus-refusal` exercises the new scenario.

## Open thread

AC #7 (Tier-3 baseline GREEN) waits on the user's VM re-provisioning. Flip to Done once that lands.
<!-- SECTION:NOTES:END -->
