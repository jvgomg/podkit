---
id: TASK-317.02
title: >-
  Doctor repair correctness pass: false-success, chicken-and-egg, wires-crossed
  text
status: To Do
assignee: []
created_date: '2026-05-09 15:19'
labels:
  - doctor
  - safety
  - ux
milestone: m-18
dependencies: []
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

- [ ] #1 `doctor --repair sysinfo-consistency` on a stale on-disk SysInfoExtended actually overwrites the file with the firmware-fresh version. Verified by re-reading the file and asserting the FireWireGUID matches the live device.
- [ ] #2 `doctor --repair sysinfo-extended -d <fresh-device>` succeeds against a freshly formatted iPod with no iTunesDB. The repair must not require an existing database.
- [ ] #3 Failure explanation text for each diagnostic check is verified against the check's actual problem. Specifically: `sysinfo-consistency` failure no longer mentions artwork.
- [ ] #4 Readiness stage's `SysInfoExtended:` status line distinguishes 'not present' from 'present but unparseable'. New string for the corrupt case.
- [ ] #5 Unit tests added: stale-SIE repair forces re-write; fresh-device repair runs without iTunesDB; corrupt-SIE readiness reports the new status. Use injected transports and synthetic XML.
- [ ] #6 Real-hardware run: (a) stale test — mini 2G, hand-edit FireWireGUID, repair, verify file rewritten; (b) chicken-and-egg test — nano 7G blue (or any device with no iTunesDB), delete SysInfoExtended, run repair, verify success; (c) corrupt-SIE test — mini 2G, truncate file, run doctor, verify status line wording.
- [ ] #7 Regression: doctor on mini 2G with healthy SysInfoExtended still passes all checks; repair when no SIE present still writes correctly.
<!-- AC:END -->
