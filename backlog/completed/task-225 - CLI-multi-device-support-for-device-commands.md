---
id: TASK-225
title: CLI multi-device support for device commands
status: Done
assignee: []
created_date: '2026-03-23 20:31'
updated_date: '2026-03-24 21:40'
labels:
  - feature
  - cli
milestone: 'Additional Device Support: Echo Mini'
dependencies:
  - TASK-222
  - TASK-223
  - TASK-224
references:
  - packages/podkit-cli/src/commands/device.ts
  - packages/podkit-cli/src/device-resolver.ts
documentation:
  - backlog/docs/doc-020 - Architecture--Multi-Device-Support-Decisions.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update CLI device commands to work with non-iPod devices. Currently `device scan`, `device info`, and `device music` assume iPod-specific behavior (libgpod database, iPod_Control directory, generation metadata).

**Commands to update:**

**`podkit device scan`** — Currently scans for iPods only. Should also find configured non-iPod devices and show their status (connected/disconnected, device type, name).

**`podkit device info`** — Currently shows iPod-specific info (generation, firmware, database stats). Should show device-appropriate info:
- Mass-storage: device type, mount point, capacity, file count, capabilities
- iPod: existing behavior unchanged

**`podkit device music`** — Currently reads from iTunesDB. Should read from MassStorageAdapter's track scan for non-iPod devices. Output format (table/JSON) stays the same.

**Commands that may need gating:**
- `podkit device init` / `podkit device reset` — iPod-only (iTunesDB operations). Should show a clear error if run against a mass-storage device, or be hidden for non-iPod devices.
- `podkit doctor` — diagnostics are device-specific. Should route to the correct diagnostic checks based on device type.

**New command:**
- `podkit device setup` — the wizard flow from config/detection task. May be created as part of that task instead.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 podkit device scan shows both iPod and non-iPod configured devices
- [ ] #2 podkit device info displays device-appropriate information for mass-storage devices
- [ ] #3 podkit device music reads tracks from MassStorageAdapter for non-iPod devices
- [ ] #4 iPod-only commands (init, reset) show clear error when run against mass-storage device
- [ ] #5 podkit doctor routes to device-appropriate diagnostic checks
- [ ] #6 Existing iPod CLI behavior unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Research findings relevant to CLI (DOC-022)

**Dual-volume:** Echo Mini mounts two volumes simultaneously. `device scan` needs to show both and indicate which is internal vs SD. `device info` should show both volumes with capacity.

**Device type display:** CLI should show device type ("Echo Mini", "iPod Classic 7G", etc.) consistently in scan/info output.

**New command considerations:**
- `podkit device setup` wizard (may be in TASK-224 instead)
- `device info` for mass-storage: show device type, mount point, capacity, file count, codec support
- `device music` for mass-storage: reads from MassStorageAdapter track scan

## Superseded by TASK-234 (2026-03-24)

TASK-234 covers all the same acceptance criteria with more specific implementation details. Unique details from TASK-225 (doctor routing, device type display consistency) have been captured in TASK-234 notes.

AC mapping:
- TASK-225 AC#1 (scan) → TASK-234 AC#5
- TASK-225 AC#2 (info) → TASK-234 AC#1
- TASK-225 AC#3 (music) → TASK-234 AC#2
- TASK-225 AC#4 (init/reset gate) → TASK-234 AC#4
- TASK-225 AC#5 (doctor) → deferred, not in current milestone scope
- TASK-225 AC#6 (iPod unchanged) → TASK-234 AC#6
<!-- SECTION:NOTES:END -->
