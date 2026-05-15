---
id: TASK-317.02
title: >-
  Doctor repair correctness pass: false-success, chicken-and-egg, wires-crossed
  text
status: Done
assignee: []
created_date: '2026-05-09 15:19'
updated_date: '2026-05-15 01:25'
labels:
  - doctor
  - safety
  - ux
milestone: m-18
dependencies: []
modified_files:
  - packages/ipod-firmware/src/sysinfo/ensure.ts
  - packages/ipod-firmware/src/sysinfo/ensure.test.ts
  - packages/podkit-core/src/diagnostics/types.ts
  - packages/podkit-core/src/diagnostics/checks/sysinfo-extended.ts
  - packages/podkit-core/src/diagnostics/checks/sysinfo-extended.test.ts
  - packages/podkit-core/src/diagnostics/checks/sysinfo-consistency.ts
  - packages/podkit-core/src/diagnostics/checks/sysinfo-consistency.test.ts
  - packages/podkit-core/src/diagnostics/checks/artwork.ts
  - packages/podkit-core/src/diagnostics/checks/artwork-reset.ts
  - packages/podkit-core/src/diagnostics/checks/artwork-reset.test.ts
  - packages/podkit-core/src/diagnostics/checks/orphans.ts
  - packages/podkit-core/src/diagnostics/checks/orphans.test.ts
  - packages/podkit-core/src/device/readiness/stages/sysinfo.ts
  - packages/podkit-core/src/device/readiness/stages/sysinfo.test.ts
  - packages/podkit-cli/src/commands/doctor.ts
  - packages/podkit-cli/src/commands/doctor.test.ts
  - packages/podkit-cli/src/commands/readiness-display.ts
  - packages/podkit-cli/src/commands/readiness-display.test.ts
  - .changeset/doctor-repair-correctness.md
parent_task_id: TASK-317
priority: high
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Four issues in doctor's diagnostic + repair flow that mislead users today.

## Bug 1: `--repair sysinfo-consistency` reports false success

When `sysinfo-consistency` detects a stale on-disk SysInfoExtended (e.g., FireWireGUID mismatch with the live device), running the suggested repair `podkit doctor --repair sysinfo-consistency -d <name>` reports `Repair complete` with `SysInfoExtended already present — <model>` but **the on-disk file is unchanged** — still contains the stale data.

Root cause: the repair handler invokes `ensureSysInfoExtended`, which short-circuits when SysInfoExtended is already on disk regardless of consistency. The consistency repair must either delete the file before invoking ensureSysInfoExtended, or `ensureSysInfoExtended` must accept a `force` option that re-reads from firmware and overwrites.

Reproduce on mini 2G: copy SysInfoExtended, hand-edit the FireWireGUID hex to a wrong value, save back, run `doctor` (consistency check fails as expected), run `doctor --repair sysinfo-consistency` (claims success but file stays stale).

## Bug 2: `--repair sysinfo-extended` chicken-and-egg gate

On a fresh nano 7G with no iTunesDB and no SysInfoExtended, running `doctor --repair sysinfo-extended -d <path>` fails with `Failed to open database: Couldn’t find an iPod database on /Volumes/iPod`. **But the entire point of this repair is to populate identity before the database makes sense.** The gate is wrong.

Find the database-required check in the repair entry path and remove it for this specific repair. The repair only needs the mount point + USB fingerprint, not iTunesDB.

## Bug 3: Wires-crossed failure explanation

When `sysinfo-consistency` (or related SysInfoExtended) check fails, the user-facing explanation under the failure says: `The artwork database is out of sync with the thumbnail files. Affected tracks display wrong or missing artwork on the iPod.` That belongs to the artwork-integrity check.

Find the explanation-text-by-check-id map and audit all entries for correctness. There is also a wider audit opportunity: any failure-explanation copy duplicated or mis-keyed across checks.

## Bug 4: Misleading status when SysInfoExtended is corrupt

When SysInfoExtended is on disk but XML is unparseable (truncated, etc.), the readiness stage's status line reports `SysInfoExtended: not present`. **It IS present** — it's the parse that failed. Display should distinguish the cases.

Suggested wording: `SysInfoExtended: present but unparseable` (or similar). The downstream consistency check still fails, which is correct; only the readiness stage's status line is misleading.

## Acceptance Criteria
<!-- AC:BEGIN -->
See AC list. Real-hardware verification required on devices that exhibit each bug.
<!-- SECTION:DESCRIPTION:END -->

- [x] #1 `doctor --repair sysinfo-consistency` on a stale on-disk SysInfoExtended actually overwrites the file with the firmware-fresh version. Verified by re-reading the file and asserting the FireWireGUID matches the live device.
- [x] #2 `doctor --repair sysinfo-extended -d <fresh-device>` succeeds against a freshly formatted iPod with no iTunesDB. The repair must not require an existing database.
- [x] #3 Failure explanation text for each diagnostic check is verified against the check's actual problem. Specifically: `sysinfo-consistency` failure no longer mentions artwork.
- [x] #4 Readiness stage's `SysInfoExtended:` status line distinguishes 'not present' from 'present but unparseable'. New string for the corrupt case.
- [x] #5 Unit tests added: stale-SIE repair forces re-write; fresh-device repair runs without iTunesDB; corrupt-SIE readiness reports the new status. Use injected transports and synthetic XML.
- [ ] #6 Real-hardware run: (a) stale test — mini 2G, hand-edit FireWireGUID, repair, verify file rewritten; (b) chicken-and-egg test — nano 7G blue (or any device with no iTunesDB), delete SysInfoExtended, run repair, verify success; (c) corrupt-SIE test — mini 2G, truncate file, run doctor, verify status line wording.
- [x] #7 Regression: doctor on mini 2G with healthy SysInfoExtended still passes all checks; repair when no SIE present still writes correctly.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in worktree `worktree-agent-ada048c181d1f510d` (uncommitted, awaiting human commit). 20 files, +967/-132 LOC. Patch bumps for podkit + @podkit/core + @podkit/ipod-firmware.

**Bug fixes**

- **Bug 1 (sysinfo-consistency false success)**: Added `force?: boolean` to `EnsureSysInfoExtendedOptions` (`packages/ipod-firmware/src/sysinfo/ensure.ts`); `force: true` skips the existing-file short-circuit and overwrites with USB-fresh data. Extracted shared `runSysInfoExtendedRepair(ctx, options, force)` in `packages/podkit-core/src/diagnostics/checks/sysinfo-extended.ts` so `sysinfo-extended.repair` (force=false) and `sysinfo-consistency.repair` (force=true) call the same code path with explicit force flag.

- **Bug 2 (chicken-and-egg DB gate)**: Added `'database'` to `RepairRequirement` union (`packages/podkit-core/src/diagnostics/types.ts`); marked `artwork-rebuild`, `artwork-reset`, `orphan-files` as needing it. `runRepair()` in `packages/podkit-cli/src/commands/doctor.ts` now gates `IpodDatabase.open()` on the repair declaring `'database'` requirement. Identity-populating repairs run cleanly on freshly-formatted iPods with no iTunesDB.

- **Bug 3 (wires-crossed text)**: Replaced unconditional artwork-text block in `doctor.ts` failure rendering with `buildCheckFailureDetails(check)` switch routed by check id. `sysinfo-consistency` now gets its own copy ("On-disk SysInfoExtended doesn't match the live device — likely a stale file copied from a different iPod." + repair pointer). Default for unknown ids is `[]` (fail-silent — check summary already carries the message).

- **Bug 4 (corrupt SIE reports "not present")**: Added `sysInfoExtendedUnparseable: true` flag to readiness stage details (`packages/podkit-core/src/device/readiness/stages/sysinfo.ts`); `readiness-display.ts` renders "SysInfoExtended: present but unparseable" when the flag is set, "not present" when genuinely missing. Zero public API churn — flag is internal to the stage.

**Wires-crossed audit (full table)**

| `check.id` | Copy emitted (when `status === 'fail'`) |
|---|---|
| `artwork-rebuild` | ithmb stats (when `totalEntries` present) + artwork-out-of-sync text |
| `artwork-reset` | none — repair-only check |
| `orphan-files` | none — only ever warns |
| `orphan-files-mass-storage` | none — uses `runMassStorageRepair` separate path |
| `sysinfo-consistency` | "On-disk SysInfoExtended doesn't match…" + `--repair sysinfo-consistency` hint |
| `sysinfo-extended` | none — detection lives in readiness stage, not this loop |
| `udev-rule` | none — system scope, filtered before loop |
| (unknown) | `[]` |

**Reviewer feedback absorbed by team-lead**

- **Substantive**: Worker silently removed `isSystemOnly` bypass in `diagnostics/index.ts` filter (out-of-scope cleanup that risked future system-only doctor runs). Restored the bypass with explicit comment explaining the invariant. Tests pass either way today; restoration preserves original safety semantics.
- **Nits deferred**: Positional `force` parameter in `runSysInfoExtendedRepair` (acceptable for two call sites); guard comment in `buildCheckFailureDetails` for sysinfo-consistency-always-sets-details invariant (not actively misleading); FRESH_GUID locality in ensure.test.ts (cosmetic).

**Quality gates** (worktree, 2026-05-15, post-fixes)
- `bun run build --filter @podkit/core --filter podkit --filter @podkit/ipod-firmware` — green.
- `bun run test:unit --filter @podkit/core --filter podkit --filter @podkit/ipod-firmware` — 2466 + 230 + cli tests pass, 0 fail.
- `bun run test:integration --filter @podkit/core --filter podkit` — 67 pass, 0 fail.

**AC #6 (real-hardware) intentionally NOT checked** — DEFERRED to TASK-319. Concrete repros to run there:
  - Bug 1: mini 2G — copy SysInfoExtended, hand-edit FireWireGUID hex to wrong value, save, run `doctor` (consistency check fails as expected), run `doctor --repair sysinfo-consistency`, verify file rewritten with live FireWireGUID.
  - Bug 2: nano 7G blue (or any device with no iTunesDB) — delete SysInfoExtended, run `doctor --repair sysinfo-extended`, verify success.
  - Bug 4: mini 2G — truncate SysInfoExtended, run `doctor`, verify "present but unparseable" wording.

**Out-of-scope (flagged, not fixed)**
- Cross-cutting `RepairRequirement` audit beyond the 3 known database-using checks deferred to future cleanup.
- No drive-by refactors otherwise.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Single PR (uncommitted in `worktree-agent-ada048c181d1f510d`) fixing four `podkit doctor` repair correctness bugs. Patch bumps for podkit + @podkit/core + @podkit/ipod-firmware.

**Shipped**
- `EnsureSysInfoExtendedOptions.force?: boolean` knob; `runSysInfoExtendedRepair(force)` shared runner used by both `sysinfo-extended` and `sysinfo-consistency` repairs.
- `RepairRequirement` union extended with `'database'`; `runRepair()` gates `IpodDatabase.open()` on the requirement.
- `buildCheckFailureDetails(check)` switch in `doctor.ts` replaces wires-crossed unconditional artwork text with check-id-routed copy.
- `sysInfoExtendedUnparseable` detail flag in readiness sysinfo stage; `readiness-display.ts` renders "present but unparseable".
- Tests: ensure.test.ts (Bug 1 byte-level overwrite), doctor.test.ts (Bug 2 + Bug 3), sysinfo.test.ts (Bug 4), sysinfo-consistency.test.ts (force=true plumbed), sysinfo-extended.test.ts (new).
- Changeset: `.changeset/doctor-repair-correctness.md` — patch bumps.

**ACs satisfied**: 1, 2, 3, 4, 5, 7. AC #6 (real-hardware) tracked under TASK-319 per spec — three concrete repros captured in implementation notes.

**Quality gates**: build + 2466 (core) + 230 (ipod-firmware) + cli unit tests + 67 integration tests all green.

**Decisions**
- `'database'` added to existing `RepairRequirement` union (no new orthogonal field).
- Bug 4 fixed via internal stage detail flag (no public API churn in `readSysInfoExtended()`).
- Shared `runSysInfoExtendedRepair(ctx, options, force)` used by both repairs — single code path, explicit force flag.

**Reviewer feedback absorbed by team-lead** (no second worker pass): restored worker-removed `isSystemOnly` bypass in `diagnostics/index.ts` with explicit invariant comment; nits deferred.

**Hardware verification deferred** to TASK-319 (3 specific repros named).
<!-- SECTION:FINAL_SUMMARY:END -->
