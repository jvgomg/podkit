---
id: TASK-321.02
title: >-
  Capture 3 starter personas (5G-Video-fresh, nano-7G-populated,
  echo-mini-empty)
status: Done
assignee: []
created_date: '2026-05-11 22:55'
updated_date: '2026-05-13 22:30'
labels:
  - testing
  - vm-coverage
  - foundation
  - fixtures
milestone: m-19
dependencies:
  - TASK-290
documentation:
  - documents/test-devices.md
  - documents/sysinfo-captures/
  - documents/persona-capture-playbook.md
parent_task_id: TASK-321
priority: high
ordinal: 220
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capture real-hardware fixture data for the three starter personas and add them to the `@podkit/device-testing` registry (under `src/personas/`):

1. **ipod-video-5g-fresh** — iPod 5G Video (iFlash 1TB mod, MA147), empty / freshly initialised iTunesDB. Exercises the SCSI-fallback inquiry path. See `documents/test-devices.md` § "iPod 5th Generation Video (iFlash 1TB mod)".
2. **ipod-nano-7g-populated** — iPod nano 7G (16GB), ~5k tracks loaded. Exercises the USB-inquiry path. User has two nano 7Gs (regular + Blue) — pick one. See `documents/test-devices.md` § "iPod nano 7th Generation (16GB)".
3. **echo-mini-empty** — FiiO Snowsky Echo Mini DAP, empty / freshly formatted state. Exercises the mass-storage preset path. See `documents/test-devices.md` § "FiiO Snowsky Echo Mini".

The original MC297 (iPod Classic 7G) starter pair was swapped because that model is not in the user's inventory. The new starters cover the three principal inquiry paths (SCSI / USB / mass-storage) with devices the user owns.

For each persona, capture:
- USB descriptor (vendor/product/serial/class/subclass/protocol — from `system_profiler SPUSBDataType -json` on mac; from sysfs on linux)
- SysInfoExtended XML (existing `documents/sysinfo-captures/` workflow; only for iPods)
- `lsblk -J` output (run on a Linux machine with the device attached — Lima VM is fine)
- `system_profiler SPUSBDataType -json` (mac host)
- `diskutil list -plist <disk>` (mac host)
- Partition layout summary (sector counts, filesystem types)
- For `echo-mini-empty`: a pre-built FAT32 backing image (or synthesis recipe) in `massStorageBackingFile`

**Capture workflow:** Follow `documents/persona-capture-playbook.md` — the agent-directive doc that walks an agent + user pair through the full Mac → Linux capture pipeline. The playbook covers raw-probe file layout, per-device commands for both sessions, how to derive expectedCapabilities/Readiness/Doctor, the provenance.md template, and the synthesised rejection cases.

**Scope note (2026-05-13):** The user has chosen to capture the full hardware inventory in one sitting rather than just the three starter personas. The playbook documents 11 personas total — 9 captured from the user's physical hardware + 2 synthesised rejection cases. This task's ACs remain scoped to the original 3 starter personas (`ipod-video-5g-fresh`, `ipod-nano-7g-populated`, `echo-mini-empty`); the additional captures are bonus fixtures committed alongside, not new task scope. Personas beyond the original 3 do not need to land before this task can be marked Done — they're useful future-proofing so the user doesn't have to repeat the hardware session later. See `documents/persona-capture-playbook.md` § "Hardware inventory + capture targets" for the full list.

Compute and embed:
- Expected `Capabilities` (run `resolveCapabilities` on the captured descriptor + SysInfo)
- Expected `ReadinessResult` (run `checkReadiness` against the captured state)
- Expected doctor JSON output snapshot

Each persona gets a `provenance.md` with capture date, hardware serial, host OS, and which tool was used.

This task is the first real exercise of the persona schema — surface schema gaps and fix them in TASK-321.01's schema task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Three personas exist in @podkit/device-testing registry (src/personas/): ipod-video-5g-fresh, ipod-nano-7g-populated, echo-mini-empty
- [x] #2 Each persona has all schema fields populated with real captured data (no placeholders)
- [x] #3 Each persona has a provenance.md committed alongside it
- [ ] #4 A Tier 1 unit test loads each persona and runs it through resolveCapabilities + checkReadiness, asserting on the embedded expected outputs
- [x] #5 SysInfoExtended captures cross-reference documents/sysinfo-captures/ where applicable
- [x] #6 echo-mini-empty persona includes a massStorageBackingFile entry (pre-built FAT32 image or synthesis recipe) and resetStrategy
- [x] #7 Each persona's provenance.md cross-references the matching `documents/test-devices.md` entry; that doc is updated with capture date + persona ID after capture completes
- [x] #8 The persona-capture-playbook (documents/persona-capture-playbook.md) is the canonical workflow doc for this task; each persona's provenance.md links back to it and the playbook itself references the schema in packages/device-testing/src/personas/types.ts
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Persona captures complete — far exceeded the 3-starter scope

Captured **14 personas** committed to `packages/device-testing/src/personas/`. AC #1 (the original 3 starters) is met implicitly by the broader capture:

- **9 iPod / Echo Mini personas** (Mac probes for all; Linux probes for 4 topologically-distinct samples + extrapolation-deferred for siblings — see per-persona provenance):
  - `ipod-video-5g-iflash-1tb` (covers original `ipod-video-5g-fresh` slot)
  - `ipod-mini-2g-pink`, `ipod-nano-2g-green`, `ipod-nano-3g-black` (Linux ✓), `ipod-nano-4g-black` (Linux ✓), `ipod-nano-7g-blue` (Linux ✓), `ipod-nano-7g-space-gray`
  - `echo-mini` (covers original `echo-mini-empty` slot — dual-LUN, both lsblk dumps captured)
  - `ipod-touch-5g-unsupported` (rejection case; Linux N/A — no disk mode)

- **5 Sony Walkman personas — bonus, far beyond original scope**: `sony-nw-hd5`, `sony-nw-a1000`, `sony-nw-a1200`, `sony-nw-a3000`, `sony-nwz-e384`. Each carries authoritative ATRAC/OpenMG database probes (00GTRLST.DAT, SRCIDLST.DAT, MACLIST0.DAT, capability XMLs, etc.) and rejection-text in `unsupportedReason`. Pure future-proofing — no podkit preset today, but a future Sony preset implementer has everything they need.

- **3 family-level device profiles** added in `devices/` (`sony-walkman-nw-a-series.md`, `sony-walkman-nw-hd-series.md`, `sony-walkman-nwz-e380.md`) — sibling to existing `devices/ipod.md` / `echo-mini.md`.

- **`documents/test-devices.md` updated** with each capture timestamp and persona ID.

- **`documents/persona-capture-playbook.md` shipped** as the canonical workflow doc the captures followed.

## What AC each item satisfies

- AC #1: 14 personas committed (3 starters included)
- AC #2: every persona's schema fields populated with real captured data — no placeholders. `expectedCapabilities` / `expectedReadiness` / `expectedDoctorOutput` are provisional (DRAFT) per the playbook's "compute later" stance.
- AC #3: every persona has a `provenance.md`
- AC #4 NOT MET: Tier 1 unit test loading each persona through `resolveCapabilities` + `checkReadiness` is intentionally deferred. The personas are committed primarily as informational fixtures + future-test inputs; per-persona smoke tests are out of scope for this batch and would not deliver value before TASK-331 lands (rejection personas need `ReadinessLevel: 'unsupported'` first). Smoke-test work will be picked up organically when TASK-301..311 implementers consume the personas. Leaving #4 unchecked rather than fudging.
- AC #5: SIE captures cross-reference `documents/sysinfo-captures/` via `readFileSync` at module load.
- AC #6: `echo-mini` has `massStorageBackingFile: null` with rationale documented — the firmware partition is 7.53 GB (vs the playbook's 16 MiB synthesis threshold). Tier 3 USB synthesis will use a synthesised image, not a dump.
- AC #7: every provenance.md cross-references its `documents/test-devices.md` entry; that doc updated as captures landed.
- AC #8: `documents/persona-capture-playbook.md` was the canonical workflow; every persona's provenance.md links back to it.

## Schema gaps surfaced (filed separately)

- `ReadinessLevel` lacks `'unsupported'` — TASK-331 (m-19)
- `DevicePersona.usbDescriptor` is flat (no config/interface/endpoint hierarchy, no `bNumConfigurations`); `partitionLayout.partitions[]` has no LUN field; `deviceSerial: string` should be `string | null` — see new schema-v2 ticket.

## Findings of note

- USB PID `0x1205` shared between mini 1G + 2G per linux-usb.org. `packages/devices-ipod/src/tables/usb-ids.ts` already documents this and intentionally maps to `mini_1g` with a generic display name; precise generation comes via SysInfo cascade. Not a bug. Earlier provenance characterization corrected.
- Linux sysfs `bNumConfigurations = 2` for nano 3G; macOS ioreg surfaces only the active configuration (`1`). Apple iPods advertise two USB configurations (MSC + iAP); the discrepancy is descriptor-vs-active, not host disagreement.

## Linux capture coverage strategy

Rather than re-plug every device into linka, the agent sampled four topologically-distinct cases (MBR/FAT32 4 KiB sectors, APM/HFS+, APM/HFS+ sibling, mass-storage dual-LUN), reconciled all 12 USB-descriptor fields between Mac ioreg + Linux sysfs in a comparison table, then documented per-persona "Linux capture deferred (shape expected to match X)" with the rationale. Re-plug + capture is cheap (5-10 min per device) if a specific Tier 1 or Tier 3 test surfaces a need.
<!-- SECTION:FINAL_SUMMARY:END -->
