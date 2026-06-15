---
id: TASK-347
title: Capture ipod-classic-rockbox persona (Rockbox install required — HITL)
status: To Do
assignee: []
created_date: '2026-05-17 14:41'
updated_date: '2026-06-15 10:26'
labels:
  - vm-testing
  - fixtures
  - hardware-required
  - deferred
milestone: m-20
dependencies: []
priority: low
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split-out from **TASK-324 AC #2**. Capturing the `ipod-classic-rockbox` persona requires a Rockbox firmware install on the user's iPod 5G Video. The install is reversible but a multi-hour commitment and needs the user's coordination. Deferred from the AFK m-19 sweep — to be picked up in a future HITL session when the user has time + interest.

## Scope (when picked up)

- Install Rockbox on a physical iPod (recommend: iPod 5G Video — the existing `ipod-video-5g-iflash-1tb` hardware)
- Capture the persona following `documents/persona-capture-playbook.md` — host probes (sysfs, ioreg, system_profiler), USB descriptors, SysInfoExtended (if Rockbox preserves it)
- Add `ipod-classic-rockbox` directory under `packages/device-testing/src/personas/`
- Register in `packages/device-testing/src/personas/index.ts`
- Test that capability synthesis recognises the firmware variant (per `packages/devices-ipod/src/capabilities.ts`)
- Update `documents/test-devices.md` with capture date + persona ID
- Cross-link back to TASK-324 AC #2 (mark complete in TASK-324 once landed)

## Out of scope

- Other firmware variants (iPodLinux, etc.)
- Rockbox database integration testing

## References

- TASK-324 AC #2 — original ask
- `documents/persona-capture-playbook.md` — capture process
- `devices/rockbox.md` — Rockbox device profile
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 User coordinates Rockbox install on iPod 5G Video (multi-hour commitment)
- [ ] #2 `ipod-classic-rockbox` persona captured per persona-capture-playbook
- [ ] #3 Persona registered in packages/device-testing/src/personas/index.ts
- [ ] #4 Capability synthesis recognises Rockbox firmware variant
- [ ] #5 documents/test-devices.md updated with capture entry
- [ ] #6 TASK-324 AC #2 marked complete
<!-- AC:END -->
