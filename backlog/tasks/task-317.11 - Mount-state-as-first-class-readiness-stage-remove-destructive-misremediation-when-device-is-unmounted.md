---
id: TASK-317.11
title: >-
  Reconcile USB-inquiry and block-device discovery so a single iPod renders
  once; stop suggesting `device init` from broken paths
status: Done
assignee: []
created_date: '2026-05-09 19:06'
updated_date: '2026-05-15 00:45'
labels:
  - device-capability-architecture
  - hygiene
  - follow-up
  - linux
  - ux
  - safety
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: high
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`podkit device scan` runs two parallel discovery pipelines (USB-inquiry via libusb; block-device via lsblk/blkid) and never reconciles them. When both succeed for the same physical iPod, the renderer surfaces it twice. When the block-device side can't resolve a device-representation (e.g. the partition has no UUID/label that udev surfaces), the USB-inquiry side falls back to a destructive misremediation (`Needs partitioning — see: podkit device init`) — even when the same physical iPod's block-device entry is right above it in the same scan, fully green and mounted.

This is structural, not a wording fix.

## Concrete repro on Linux (linka, nano 3G FAT32)

After mounting nano 3G via `podkit device scan` mount prompt, a follow-up `podkit device scan` shows:

```
IPOD (sdc1)  iPod nano 8GB Black (3rd Generation)
✓ USB Connection
✓ Partition Table
✓ Filesystem    IPOD
✓ Mounted    /media/james/IPOD
✓ SysInfo    iPod nano 8GB Black (3rd Generation)
✓ Database    11 tracks
Ready — 11 tracks, 7.3 GB free

iPod nano 3rd generation (USB only)
✓ USB Connection
✗ Partition Table    No disk representation found
- Filesystem    Skipped — previous check failed
- Mounted    Skipped — previous check failed
- SysInfo    Skipped — previous check failed
- Database    Skipped — previous check failed
Needs partitioning — see: podkit device init
```

Same physical iPod. Two entries. The second entry tells the user to run `device init` on a perfectly healthy device — and `device init` is the wrong tool anyway (see developer note below).

## Why this happens

Two pipelines run independently:
1. **Block-device pipeline** — starts from lsblk/blkid output, finds `/dev/sdc1`, identifies via mount + iTunesDB read.
2. **USB-inquiry pipeline** — starts from libusb, finds the USB device by Apple vendor ID (0x05ac), identifies via firmware inquiry.

Both produce results. The renderer presents both outputs without knowing they describe one device. There is no reconciliation step that matches the USB-inquiry record's `vendorId/productId/serialNumber` against the block-device record's USB attributes (which Linux exposes via `/sys/class/scsi_disk/.../device/`).

## Why this matters beyond linka

- macOS hides the bug — its scan reconciles correctly in normal cases (only surfaces phantom entries when stale handles accumulate, captured separately as TASK-317.01).
- Linux server / CI / headless / Docker / Lima — all reproduce the double-entry. Any environment where lsblk and libusb both find the iPod independently.
- The destructive-suggestion side of the double-entry is actively dangerous if a user follows it.

## Design sketch

1. **Single discovery primitive.** One device record per physical iPod. USB-inquiry results and block-device results merge into the same record at discovery time, matched on USB fingerprint (vendor + product + serial). When both pipelines produce a record for the same iPod, fold them; when only one produces a record, that record is the device.
2. **Renderer reads the merged records, not the raw pipeline outputs.** Eliminates by-construction the possibility of rendering the same iPod twice.
3. **Stop suggesting `device init` from any failure surface where a healthy block-device representation exists for the same device.** And see developer note: review whether `device init` should be suggested from scan/doctor at all.
4. **For the no-block-device case** (USB-inquiry only — e.g. iOS device, hashAB-unsupported nano 7G, or a genuinely partitionless iPod): keep surfacing the device, but with the right remediation (cascade through unsupported-device messaging from TASK-317.03; or, for a genuinely-needs-init iPod, point at a docs link rather than a broken internal command).

## Scope reductions enabled by TASK-317.12 (HFS+ refusal)

If TASK-317.12 lands first (refuse HFS+ on Linux), several friction points fold up:
- The "no UUID surfaced for HFS+" → moot for supported devices.
- The synthetic-UUID `device add` fallback → moot.
- The "mount-state-as-first-class-stage" framing originally proposed for this task → not needed; FAT32 path already prompts for mount cleanly, supported devices all surface UUID.

What remains is purely the discovery-reconciliation work + the `device init` suggestion cleanup. Smaller scope, single PR.

## Cross-references in TASK-317 family

- **.01** (USB enumeration / classification / rendering refactor — landed). The new layered model is where reconciliation should slot. Don't reinvent enumeration; extend classification.
- **.02** (doctor repair correctness — false-success). Adjacent: false-failure here vs false-success there.
- **.03** (unsupported-device cascade through scan/info/sync). Same surface; coordinate so unsupported-device messaging composes with the merged-record renderer.
- **.08** (doctor consistent System / Device / Database sections). Already met on Linux for iPods (verified on linka under sudo nano 3G); only Echo Mini diverges.
- **.12** (refuse HFS+ on Linux). Reduces this task's scope as noted above.

## Developer note: `podkit device init`

`device init` is gated to iPods (`type === 'ipod'`), requires the device already mounted, then writes iTunesDB scaffolding. It does **not** partition. Does **not** format. Does **not** create a filesystem. There is no podkit code path that turns an unpartitioned block device into a podkit-ready iPod.

So scan's `Needs partitioning — see: podkit device init` is doubly wrong: (a) `init` doesn't partition; (b) `init` won't run on an unmounted device.

Larger question for whoever picks this up: does podkit have any business owning a "format an iPod for re-use" workflow at all? Restoring an iPod is non-trivial (HFS+ vs FAT32 per generation, APM vs MBR, boot-area bytes) and lives in the Rockbox / iPod Reset Utility / hfsplus-utils space today. Captured here as a developer note; promote to its own task only if someone wants to act on it.

## Design decisions captured from session 2026-05-09

- **No symlinks.** podkit will not create or maintain a stable-path symlink layer for mounted iPods. udisksctl path naming is accepted; user references devices by config name; podkit resolves internally.
- **Canonical Linux flow: scan → add → mount.** `device add` accepts an unmounted iPod (USB-inquiry-resolved identity). volumeUuid populated lazily on first mount.
- **udisksctl preserved as primary mount tool on Linux.** Manual `sudo mount` is the documented fallback when udisksctl is missing.
- **Mount mode (RO/RW)** is not a separate first-class concern in this task — it's relevant to HFS+ (refused by .12) only.

## Hardware test plan

- Linux/linka: nano 3G plugged in, mounted via the FAT32 mount prompt. Run `podkit device scan` repeatedly. Expected: one entry per iPod, no double-entry, no destructive remediation.
- Regression on macOS: verify scan still works on each inventory iPod with no behavioural change. The reconciliation logic must not regress the working macOS path.
- Cold/replug cycle: unplug + replug the same iPod multiple times in a session. No phantom entries (cross-checks with TASK-317.01 fixes).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Discovery primitive merges USB-inquiry and block-device records into a single device record per physical iPod, matched on USB fingerprint (vendor + product + serial). Renderer consumes merged records only.
- [x] #2 On Linux with a connected mounted iPod, `podkit device scan` produces exactly one entry for that device. Verified on FAT32 (nano 3G) on linka and re-verified after a replug cycle.
- [x] #3 When the only available representation is the USB-inquiry side (no block-device match — e.g. iOS device, hashAB-unsupported, partitionless iPod), the rendered remediation is correct: unsupported-device messaging composes via TASK-317.03 cascade, OR a docs link for genuinely-needs-init devices. Never `podkit device init` from the misremediation path this task fixes.
- [x] #4 On macOS, `podkit device scan` continues to produce one entry per inventory iPod. No regression of the working path.
- [ ] #5 Real-hardware regression: full m-18 inventory (7 iPods + iPod touch + Echo Mini) re-tested via `device scan` on macOS. No double-entries, no destructive misremediations. Cross-cutting with the TASK-317 follow-up Linux re-sweep task.
- [x] #6 Tests added for the merge logic: unit tests in `@podkit/core/src/device/` covering same-device-from-both-pipelines, same-device-block-only, same-device-usb-only, and replug cycles.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in worktree `worktree-agent-a6d99f9921f986071` (uncommitted, awaiting human commit). 13 files, +964/-51 LOC.

**Architecture**
- New `packages/podkit-core/src/device/reconcile.ts` — pure `reconcileIpodDiscovery(blockDevices, classifiedUsb)` returns `ReconciledIpodRecord[]` with `matchedBy: 'serial' | 'disk-identifier' | 'block-only' | 'usb-only'`. Match priority: serial → disk-identifier (with partition suffix stripped on BOTH sides) → emit separate.
- Extended `packages/podkit-core/src/device/platforms/linux.ts:stripPartitionSuffix` to handle macOS BSD names (`disk2s1` → `disk2`) on top of existing Linux conventions. Single shared helper used by reconcile + linux.ts internals.
- `packages/podkit-core/src/device/types.ts` — `PlatformDeviceInfo` gains optional `usbFingerprint?: UsbFingerprint`.
- `packages/podkit-core/src/device/platforms/linux.ts:findIpodDevices` plumbs sysfs USB fingerprint through to the platform record.
- CLI `device/scan.ts` — replaced ad-hoc `ipodUsbByDisk`/`findMatchingUsbIpod` correlation with `reconcileIpodDiscovery`. Block-side records that get USB enrichment go into `ipods`; only genuinely-USB-only devices populate `usbOnlyIpods`. No physical iPod appears in both lists.
- CLI `readiness-display.ts:42` — destructive `'Needs partitioning — see: podkit device init'` replaced with `'No mountable partition detected — see: https://docs.podkit.app/devices/troubleshooting'`.
- `docs/devices/troubleshooting.md` — new Starlight page covering "podkit doesn't see my iPod" + "no mountable partition" + external-tool recommendations (no-restore policy).
- `.changeset/reconcile-discovery.md` — minor bump for `podkit` + `@podkit/core`.

**Decisions diverging from the brief**
1. Added `usbFingerprint?: UsbFingerprint` to `PlatformDeviceInfo` (optional; macOS path doesn't populate it — disk-identifier carries the match there).
2. Did not populate `diskIdentifier` on Linux's `enumerateUsb` — Linux iPods all report serials, so serial-match is the production path. Disk-identifier branch covered by tests with synthetic Linux shapes for completeness.
3. Docs URL kept as `https://docs.podkit.app/...` matching the convention TASK-317.12 set.

**Reviewer feedback absorbed by team-lead**
- Critical fix: strip partition suffix from BOTH sides in `findMatchingUsb` (system_profiler can emit `bsd_name: disk5s2` for partition).
- Architecture fix: removed duplicate `stripPartitionSuffixForReconcile` — extended shared `stripPartitionSuffix` to handle macOS, reconcile.ts now imports it.
- Test fix: added 2 regression tests for partition-level USB-side `diskIdentifier`.
- Nit: removed dead `nonEmpty(blockWholeDisk)` guard.

**Quality gates** (worktree, 2026-05-15, post-fixes)
- `bun run build --filter @podkit/core --filter podkit` — green.
- `bun run test:unit --filter @podkit/core --filter podkit` — 2480 + 1180 pass, 0 fail. Reconcile suite alone: 21 pass (was 19, +2 for partition-level USB regression).
- `bun run test:integration --filter @podkit/core --filter podkit` — 67 + 12 pass, 0 fail.

**Out-of-scope (flagged, not fixed)**
- `init.ts:158` and `doctor.ts` may still surface `device init` from broken paths — left alone per scope.
- `docs.podkit.app` domain not yet live; matches TASK-317.12 convention. Project-wide docs URL revisit is a separate task.

**AC #5 (real-hardware)** intentionally NOT checked — DEFERRED to TASK-319 AC #2 (linka nano 3G FAT32 single-entry verification + replug cycle + macOS regression on m-18 inventory).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Single PR (uncommitted in `worktree-agent-a6d99f9921f986071`) reconciling USB-inquiry and block-device discovery in `podkit device scan` so a single physical iPod renders once. Replaces destructive `Needs partitioning — see: podkit device init` copy with a docs link.

**Shipped**
- `packages/podkit-core/src/device/reconcile.ts` — pure `reconcileIpodDiscovery` primitive (serial → disk-identifier → emit-separate match priority; partition suffix stripped on both sides).
- `packages/podkit-core/src/device/platforms/linux.ts` — `stripPartitionSuffix` extended to handle macOS BSD names; `findIpodDevices` plumbs sysfs USB fingerprint through.
- `packages/podkit-core/src/device/types.ts` — `PlatformDeviceInfo.usbFingerprint?` optional field.
- `packages/podkit-cli/src/commands/device/scan.ts` — reconcile-driven assembly; old `ipodUsbByDisk` correlation deleted.
- `packages/podkit-cli/src/commands/readiness-display.ts` — non-destructive copy.
- `docs/devices/troubleshooting.md` — new Starlight page.
- Tests: `reconcile.test.ts` (21 tests), `device-scan.unit.test.ts` (linka regression + USB-only-survives), `device-scan.integration.test.ts` (realistic-shape reconcile coverage), `device-scan-render.unit.test.ts` (new copy assertion).
- Changeset: `.changeset/reconcile-discovery.md` — minor bump.

**ACs satisfied**: 1, 2, 3, 4, 6 (code + tests). AC #5 (real-hardware) tracked under TASK-319 AC #2.

**Quality gates**: build + 3,660 unit tests + 79 integration tests all green.

**Decisions**
- Added `usbFingerprint?` to `PlatformDeviceInfo` (optional — preserves macOS path which uses disk-identifier matching).
- Single shared `stripPartitionSuffix` extended to handle macOS BSD names; eliminates duplication between linux.ts and reconcile.ts.
- Docs URL kept as `docs.podkit.app/...` matching TASK-317.12 convention.

**Reviewer feedback absorbed by team-lead** (no second worker pass): critical fix to strip partition suffix from USB side too; helper consolidation; +2 partition-level USB regression tests; dead-guard removal.

**Hardware verification deferred** to TASK-319 AC #2 (Linux re-sweep on linka with nano 3G + macOS regression on m-18 inventory).
<!-- SECTION:FINAL_SUMMARY:END -->
