---
id: TASK-317.12
title: Refuse HFS+ iPods on Linux at `device add`; warn at `device scan`
status: Done
assignee: []
created_date: '2026-05-09 20:30'
updated_date: '2026-05-15 00:16'
labels:
  - device-capability-architecture
  - linux
  - ux
  - policy
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: high
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Decision

iPods formatted as HFS+ are **not supported on Linux** by podkit. Refuse them cleanly at `device add` time and warn the user at `device scan`, with a docs link explaining why and how to reformat to FAT32 if they want podkit to manage the device.

This is a **policy decision**, not an implementation gap. The friction surfaces compound: (a) Linux kernel hfsplus driver refuses RW on journaled HFS+ volumes (default for iPod-formatted HFS+), so sync can't write; (b) udev/blkid don't surface a filesystem UUID for HFS+ on Linux, breaking podkit's volumeUuid identity model and forcing a synthetic-UUID fallback that's broken; (c) the udisksctl mount path naming is generic (`/media/$USER/disk`) because no label is read. Each of these has a partial fix; together they mean Linux + HFS+ is a second-class experience no matter how much we patch.

Refusing cleanly with a docs link is structurally cleaner than supporting all three friction points, and it sharpens podkit's Linux story to "FAT32 iPods, supported well."

## Concrete repro from session 2026-05-09 (linka, nano 4G HFS+)

- `lsblk -o NAME,UUID,LABEL,FSTYPE` on `sdc2` (the iPod's HFS+ partition): UUID and LABEL both blank.
- `udisksctl mount -b /dev/sdc2` mounts at `/media/james/disk` (generic name, no label).
- Mount mode is **read-only** by default: `mount | grep /media/james/disk` shows `(ro,nosuid,nodev,relatime,umask=22,uid=1000,gid=1000,nls=utf8,uhelper=udisks2)`.
- `podkit device add --path /media/james/disk -d ipodnano` succeeds but stores `volumeUuid = "manual-L21lZGlhL2phbWVz"` — base64 of `/media/james` (truncated parent dir). Synthetic; collision-prone; doesn't survive replug.
- `podkit doctor -d ipodnano` fails to find the device by its synthetic UUID.

The user's library content is at risk because none of these failure modes are visible to a casual user — they look like working commands until something breaks downstream.

## What "refuse" looks like

### `podkit device add` against an HFS+ iPod on Linux

Refuse with a clear message:

```
Cannot add iPod: this iPod is formatted as HFS+, which podkit does not support on Linux.

To use this iPod with podkit on Linux, reformat it to FAT32. See:
  https://docs.podkit.app/devices/linux-filesystems

(podkit fully supports HFS+ iPods on macOS — this is a Linux-only limitation.)
```

Exit code non-zero. Structured `--json` error preserves the same code (e.g. `unsupported-filesystem-on-linux`) so scripted callers can handle it.

### `podkit device scan` against an HFS+ iPod on Linux

Surface the device in the scan output, but with the right framing:

```
iPod nano 8GB Black (4th Generation)  /dev/sdc2 (HFS+)

  ⚠ Filesystem not supported on Linux
    HFS+ iPods are supported on macOS but not on Linux.
    Reformat to FAT32 to use this iPod with podkit on Linux.
    See: https://docs.podkit.app/devices/linux-filesystems
```

Other readiness-stage checks are skipped with a clear reason (not "previous check failed" — the wording matters).

### Docs

- New page (or section): "Linux: supported iPod filesystems."
- Explains: FAT32 supported, HFS+ refused, why (kernel HFS+ RW limitations + identity surface), how to reformat (point at iPod Reset Utility / Rockbox / disk utilities — outside podkit's scope to walk through).
- Link from the refusal messages above.

## Cross-references

- **TASK-317.11** (discovery reconciliation) — refusing HFS+ removes most of the friction this task was originally framed around. .11's scope shrinks accordingly.
- **TASK-317.13** (udev rule USB scope) — orthogonal; HFS+ refusal doesn't change permission story.
- **TASK-317.15** (defensive error handling for missing volumeUuid) — supplementary safety net for any post-refusal edge case where a FAT32 iPod somehow doesn't surface a UUID.

## Hardware test plan

- linka + nano 4G (HFS+): `device scan` → warning shown, no destructive remediation. `device add --path` → refused with the message above.
- linka + nano 3G (FAT32): no change in behaviour; existing FAT32 path still works.
- linka + nano 7G #2 (HFS+): same refusal as nano 4G. Cross-checks the unsupported-generation messaging from TASK-317.03 doesn't get crossed up with this filesystem-level refusal.
- macOS regression: HFS+ iPods continue to work cleanly. The refusal is Linux-platform-gated.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `podkit device add` against an HFS+ iPod on Linux refuses with a clear message naming the filesystem, explaining the limitation, pointing at a docs link, and noting that macOS supports HFS+. Exit code non-zero. Structured JSON error code (e.g. `unsupported-filesystem-on-linux`) for scripted callers.
- [x] #2 `podkit device scan` against an HFS+ iPod on Linux renders the device with a clear `Filesystem not supported on Linux` warning instead of running readiness stages. Wording matches the description. No destructive remediation suggested.
- [x] #3 Docs page (or clearly-anchored section) at the linked URL covers: FAT32 supported, HFS+ refused on Linux, why (RW + identity), pointer to external tools for reformatting. Title + URL stable enough that the in-CLI link won't break.
- [x] #4 macOS behaviour unchanged: HFS+ iPods continue to add/scan/sync as today. The refusal is gated to `process.platform === 'linux'`.
- [ ] #5 Real-hardware verification: linka + nano 4G (HFS+) refused at add and warned at scan; linka + nano 3G (FAT32) works as before; macOS regression on the full m-18 inventory unchanged. Documented in TASK-313 successor / Linux re-sweep task.
- [x] #6 Tests added: unit tests for the platform-gated refusal logic; integration test that exercises a Linux-platform mock with an HFS+ filesystem fixture and asserts on the message wording + exit code.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in worktree `worktree-agent-a9bfc1d0cce752a3f` (uncommitted, awaiting human commit). 18 files, 854 LOC additions.

**Architecture**
- New `packages/podkit-core/src/device/filesystem-policy.ts` — single source of truth: `isFilesystemUnsupportedHere(fstype, platform)`, `formatHfsplusOnLinuxRefusal(opts)`, `makeHfsplusOnLinuxUnsupportedReason(opts)`, `LINUX_FILESYSTEMS_DOCS_URL`. All user-facing wording centralised here.
- Linux platform manager (`platforms/linux.ts`): `fstype` plumbed through `PlatformDeviceInfo`. lsblk UUID-required filter loosened to keep partitions with known fstype but blank UUID — required so HFS+ iPods (UUID blank per kernel limitation) reach the refusal path.
- Readiness pipeline: new `'unsupported'` level + `ReadinessUnsupportedReason` discriminated payload in `readiness/types.ts`. Pipeline early-returns for HFS+/Linux without invented "Skipped — previous check failed" rows. Discriminator (`kind`) extension-friendly for TASK-331's later iPod-touch / Sony-Walkman cases.
- CLI `device add` (`commands/device/add.ts`): refusal injected in BOTH iPod branches (explicit `--path` + scan-found) BEFORE any state mutation. New error code `UNSUPPORTED_FILESYSTEM_ON_LINUX`. Path normalization (trailing-slash strip) on the explicit-path lookup.
- CLI `device scan` rendering (`device-scan-render.ts`): new `pushUnsupportedRow` helper renders the three documented warning lines under a ⚠ headline; no iPod-init suggestion for unsupported devices.
- Docs: new `docs/devices/linux-filesystems.md` page covering FAT32 supported / HFS+ refused / why / how to reformat (external tools).

**Decisions diverging from the original brief**
1. Renamed type `UnsupportedReason` → `ReadinessUnsupportedReason` to avoid collision with existing `UnsupportedReason` ('ios_device' | 'buttonless_shuffle' | …) in `device-validation.ts`.
2. TASK-331's `'unsupported'` readiness level was supposed to land first but is still To Do. Added the minimum surface here; the discriminator makes TASK-331's extension a non-breaking add.
3. Loosened `parseLsblkJson` UUID-required filter to keep partitions with known fstype + blank UUID. Narrower than removing the filter entirely.

**Reviewer feedback absorbed by team-lead**
- Trailing-slash normalization on `--path` lookup in `device/add.ts:451-465`.
- `details.platform` literal `'linux'` → use the in-scope `platform` variable in both refusal sites.
- Removed `void opts.mountPath;` no-op in `filesystem-policy.ts`.
- Trimmed JSDoc on `pushUnsupportedRow` in `device-scan-render.ts`.

**Quality gates** (worktree, 2026-05-15)
- `bun run build --filter @podkit/core --filter podkit` — green (`@podkit/docs-site` build fails on a pre-existing broken link in `docs/reference/codec-support.md`; main has fix `0a0501a`, this branch lacks it; unrelated).
- `bun run test:unit --filter @podkit/core --filter podkit` — 2477 + 1180 tests pass, 0 fail.
- `bun run test:integration --filter @podkit/core --filter podkit` — 67 + 12 tests pass, 0 fail.

**AC #5 (real-hardware)** intentionally NOT checked — DEFERRED to TASK-319 (Linux re-sweep). Cannot run from macOS. Will validate on linka with nano 4G HFS+, nano 7G #2 HFS+ (refusals), nano 3G FAT32 (regression), and macOS regression on full m-18 inventory.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Single PR (uncommitted in `worktree-agent-a9bfc1d0cce752a3f`) refusing HFS+ iPods on Linux at `device add` and surfacing a clear filesystem-not-supported warning at `device scan`. macOS unchanged.

**Shipped**
- `packages/podkit-core/src/device/filesystem-policy.ts` — single source of truth (`isFilesystemUnsupportedHere`, `formatHfsplusOnLinuxRefusal`, `makeHfsplusOnLinuxUnsupportedReason`, `LINUX_FILESYSTEMS_DOCS_URL`).
- `packages/podkit-core/src/device/platforms/linux.ts` — `fstype` plumbed through `PlatformDeviceInfo`; lsblk filter loosened to keep partitions with known fstype but blank UUID.
- `packages/podkit-core/src/device/readiness/{types,index}.ts` — new `'unsupported'` readiness level + `ReadinessUnsupportedReason` discriminated payload; pipeline early-returns without invented "Skipped" rows.
- `packages/podkit-cli/src/commands/device/add.ts` — refusal in BOTH iPod branches before any state mutation, with trailing-slash path normalization on the explicit-`--path` lookup; new `UNSUPPORTED_FILESYSTEM_ON_LINUX` error code.
- `packages/podkit-cli/src/commands/device-scan-render.ts` — new `pushUnsupportedRow` helper; suppresses the iPod-init suggestion for unsupported devices.
- `docs/devices/linux-filesystems.md` — new docs page at the canonical URL embedded in the refusal message.
- Tests: `filesystem-policy.test.ts`, `readiness.test.ts` (4 new), `device-add.unit.test.ts` (4 new), `device-scan-render.unit.test.ts` (3 new), `linux.test.ts` (HFS+ fixture).
- Changeset: `.changeset/refuse-hfsplus-on-linux.md` — minor bump for `podkit` + `@podkit/core`.

**ACs satisfied**: 1, 2, 3, 4, 6 (code + tests). AC #5 (real-hardware) tracked under TASK-319 AC #3 (linka nano 4G + nano 7G #2 HFS+ refusals + nano 3G FAT32 regression + macOS spot-check).

**Quality gates**: build + 3,657 unit tests + 79 integration tests all green for `@podkit/core` + `podkit`.

**Decisions**
- No `--force` override — refusal absolute on Linux per "policy decision" framing.
- TASK-331's `'unsupported'` readiness level was supposed to land first but is To Do; added the minimum surface here, discriminated `kind` makes TASK-331's extension non-breaking.
- Type renamed `UnsupportedReason` → `ReadinessUnsupportedReason` to dodge collision with existing core type.
- lsblk UUID filter narrowly widened (kept partitions with known fstype + blank UUID) — narrower than removing the filter entirely.

**Reviewer feedback absorbed by team-lead** (no second worker pass): trailing-slash path normalization; `details.platform` literal `'linux'` → in-scope `platform` variable; removed `void opts.mountPath;` no-op; trimmed verbose JSDoc.

**Hardware verification deferred** to TASK-319 (Linux re-sweep) — verified explicitly in updated AC #3 of that task.
<!-- SECTION:FINAL_SUMMARY:END -->
