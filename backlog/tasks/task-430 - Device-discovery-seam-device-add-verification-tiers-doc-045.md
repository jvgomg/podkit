---
id: TASK-430
title: Device discovery seam + device add verification tiers (doc-045)
status: To Do
assignee: []
created_date: '2026-06-21 09:26'
labels:
  - device-add
  - device-discovery
  - core-refactor
  - epic
milestone: m-18
dependencies: []
references:
  - doc-045 - PRD-Device-discovery-seam-device-add-verification-tiers.md
ordinal: 145000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Master task tracking the implementation of PRD doc-045 — "Device discovery seam + device add verification tiers".

Two coordinated changes:
1. A clean core discovery seam: replace the four enumerate-and-filter `DeviceManager` methods (`listDevices`, `findIpodDevices`, `findByVolumeUuid`, `getUuidForMountPoint`) with `scan({ kinds? })` (enumerate many) and `locate({ volumeUuid | path })` (retrieve one, direct OS query, no enumeration).
2. Three verification tiers for `device add`: **verify** (default, SCSI cross-check), **`--no-verify`** (trust on-disk SysInfo, required), **`--no-validate`** (config-inject, touches nothing). Renames `--no-firmware-inquiry → --no-verify`; subsumes the `--no-scan` idea and the `PODKIT_TEST_SYNTHETIC_VOLUME_UUID` env-var hatch.

See doc-045 for the full design, scenario matrix, module sketch (M1 scan/locate, M3 add-request resolver, M4 verification policy), test plan, and the Docker-SCSI open risk. Supersedes the archived TASK-344.

Subtasks track the vertical/phased slices. Critical path: spike → core seam → M3/M4 → wire tiers → e2e migration → docs. Loop-collapse and CLI de-leakage hang off the core seam and run in parallel.
<!-- SECTION:DESCRIPTION:END -->
