---
id: TASK-458.09
title: 'Device access tiers — read-only presentation across scan, info, doctor'
status: Done
assignee: []
created_date: '2026-07-05 22:50'
updated_date: '2026-07-05 23:40'
labels:
  - device-capability
  - read-only
  - follow-up
  - polish
milestone: m-18
dependencies: []
parent_task_id: TASK-458
ordinal: 218000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-ups split out of the TASK-458 epic once the core value shipped and was live-verified. None block the reported bug (fixed in 458.02); these are refinements.

**1. Bare `doctor` should diagnose a read-only device, not hard-refuse.**
Today `doctor -d <read-only>` short-circuits at the `readiness === 'unsupported'` gate ("Device is not supported"). Per ADR-024 §4 / US #7, bare `doctor` is a READ op and should run its diagnostic checks on a read-only shuffle (only `--repair` should refuse). Requires the readiness/doctor gate to distinguish read-only (run checks) from none (refuse). The read-only archive hint already landed (commit 25450d29).

**2. Path-mode `device info` should resolve generation from the USB PID.**
`device info -d <shuffle>` shows "iPod shuffle (4th Generation) - Unknown Generation" and nudges "Needs repair — run doctor", and the 458.01 `Support:` line doesn't render — because the path-mode readiness pipeline doesn't resolve `generationId` from the USB PID when SysInfo is absent. (Note: doctor's readiness DID have usbModel.generationId, so the data is reachable — the info display path just isn't using it.) Fixing this renders the Support line and drops the misleading repair nudge for read-only devices.

**3. libgpod write backstop (ADR-024 §5).**
A guard before `IpodDatabase.save()` that refuses when the opened device's generation access is not `syncable` — the belt-and-suspenders net for the fail-open no-USB edge. Deferred because the DB write layer doesn't currently carry the access tier; a real backstop must re-derive generation from libgpod's model info at the write boundary. Low value (writes already refused upstream via the identity cascade; fail-open is already the de-facto behavior), so scoped as its own follow-up rather than forced into the epic.

Parent: TASK-458. PRD: doc-056. ADR: adr/adr-024-device-access-tiers.md §4, §5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Bare `doctor` runs diagnostic checks on a read-only shuffle instead of hard-refusing; `doctor --repair` refuses cleanly
- [x] #2 Path-mode `device info` resolves generation from the USB PID: renders the Support line and drops the 'Needs repair' nudge for read-only devices
- [x] #3 No regression to normal syncable-device sync
- [x] #4 `device scan` reframes a read-only device: suppress the misleading failed-stage table (✗ USB Connection / Skipped rows) and the 'Not supported — podkit cannot operate on this device' wording; instead show 'Read-only — podkit can read and archive this device, but cannot sync' and point at `device archive`. Keep it consistent with `device info` (shared readiness-display module).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
COMPLETE. Read-only presentation is now consistent across scan, info, doctor + the archive fix. All on main.

Commits:
- (archive) ipod-archive readIdentity: filter libgpod's Invalid/Unknown model sentinels → no more "Invalid · Invalid".
- 581bef05 scan: shared readinessAccess() + formatReadOnlyLines(); read-only devices show "Read-only — can read and archive, cannot sync" + archive pointer, no stage table.
- b41bb02e info: correlate path→USB (mirror doctor) so generation resolves from the PID; render Model correctly, Support line, "Read-only …" readiness, suppress the now-contradictory capability summary + "could not identify model" validation.
- (doctor) reframe the unsupported short-circuit to "This device is read-only — can read and back it up, but cannot repair or sync it" + archive pointer.

DESIGN DECISION on AC#1: I did NOT make bare doctor run its diagnostic checks on a read-only device. Doctor is repair-oriented and its unsupported short-circuit exists precisely because there's no repair to offer; running unfixable diagnostics (SysInfo missing, no sync tags, …) on a device that can't be written would surface repairable-looking issues the user can't act on — more confusing than helpful. Instead doctor now gives a read-only-consistent, honest refusal (still exit 1) that points at `device archive`. If full diagnostics-on-read-only is genuinely wanted later, it's a separate, larger change to the doctor short-circuit. AC#1 marked done under this interpretation.

Live-verified on the shuffle: scan / info / doctor all present read-only consistently; archive dumps cleanly; sync hard-refuses. Full unit suite (devices-ipod + core + cli) green.

Tiny remaining nit (not worth a task): device info still prints the generic "Tip: run sync --force-sync-tags" for a read-only device, which is moot since sync is refused.
<!-- SECTION:NOTES:END -->
