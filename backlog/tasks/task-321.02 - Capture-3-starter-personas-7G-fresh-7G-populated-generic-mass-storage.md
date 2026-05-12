---
id: TASK-321.02
title: >-
  Capture 3 starter personas (5G-Video-fresh, nano-7G-populated,
  echo-mini-empty)
status: To Do
assignee: []
created_date: '2026-05-11 22:55'
updated_date: '2026-05-12 12:12'
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

**Human-in-the-loop capture flow:**

Each capture session requires physical hardware to be plugged in. The flow is:
1. User plugs device into their Mac.
2. Agent runs `bun run device-testing:capture --persona <id>` on the mac host (or `packages/device-testing/scripts/capture-persona.ts` directly). The script prompts for the device disk path, then captures `system_profiler SPUSBDataType -json`, `diskutil list -plist`, and USB descriptor fields automatically.
3. For Linux-side captures (`lsblk -J`): user connects the device to a Linux machine OR uses Lima USB passthrough to pass it through to a VM. Agent runs the lsblk capture step inside the VM.
4. Agent commits captured data + auto-generated `provenance.md` (capture date, hardware serial, host OS, operator, command used) + updates `documents/test-devices.md` with capture date and persona ID.

Compute and embed:
- Expected `Capabilities` (run `resolveCapabilities` on the captured descriptor + SysInfo)
- Expected `ReadinessResult` (run `checkReadiness` against the captured state)
- Expected doctor JSON output snapshot

Each persona gets a `provenance.md` with capture date, hardware serial, host OS, and which tool was used.

This task is the first real exercise of the persona schema — surface schema gaps and fix them in TASK-321.01's schema task.

The capture script (`packages/device-testing/scripts/capture-persona.ts`) must be invokable from the CLI, prompts for the device path, and writes output to the correct fixture location automatically.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Three personas exist in @podkit/device-testing registry (src/personas/): ipod-video-5g-fresh, ipod-nano-7g-populated, echo-mini-empty
- [ ] #2 Each persona has all schema fields populated with real captured data (no placeholders)
- [ ] #3 Each persona has a provenance.md committed alongside it
- [ ] #4 capture-persona.ts script exists at packages/device-testing/scripts/capture-persona.ts; it is invokable from the CLI, prompts for device path, and writes captured data to the correct fixture location
- [ ] #5 Human-in-the-loop capture flow is documented in the script's --help output and in the persona's provenance.md
- [ ] #6 A Tier 1 unit test loads each persona and runs it through resolveCapabilities + checkReadiness, asserting on the embedded expected outputs
- [ ] #7 SysInfoExtended captures cross-reference documents/sysinfo-captures/ where applicable
- [ ] #8 echo-mini-empty persona includes a massStorageBackingFile entry (pre-built FAT32 image or synthesis recipe) and resetStrategy
- [ ] #9 Each persona's provenance.md cross-references the matching `documents/test-devices.md` entry; that doc is updated with capture date + persona ID after capture completes
<!-- AC:END -->
