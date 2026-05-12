---
id: TASK-309
title: Doctor across device types and presets
status: To Do
assignee: []
created_date: '2026-05-08 07:24'
updated_date: '2026-05-12 11:56'
labels:
  - testing
  - doctor
  - device-types
  - vm-coverage
milestone: m-19
dependencies: []
priority: medium
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify doctor selects the correct check set for each device type and preset, and that the per-type code paths produce the expected output shape. The check registry filters by `applicableTo` (`'ipod' | 'mass-storage'`); doctor's behaviour also branches on `deviceConfig.type` (`undefined`/`'ipod'` vs everything else). Today's coverage runs doctor against a dummy iPod and an echo-mini fixture; the other device-type permutations (rockbox, generic, unsupported) and the preset-resolution chain are not exercised end-to-end.

For every test, run `podkit doctor --device <name|path> --json --no-system` and assert on:
- `deviceType` in JSON output
- the set of check IDs present in `checks[]` (no iPod-only checks for mass-storage devices, no mass-storage checks for iPod, etc.)
- `deviceModel` resolves to the right human-readable label per type
- text-mode section headers match the type ('Database Health' for iPod, 'Device Health' for mass-storage)

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` from `@podkit/device-testing`; the `ipod-video-5g-fresh` persona covers iPod-type assertions; the `echo-mini-empty` persona covers mass-storage-type assertions; `DevicePersona.expectedCapabilities` and `expectedDoctorOutput` supply the expected values
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner against the starter personas to confirm device-type selection on real kernel-level USB enumeration
- See `agents/device-testing.md` and ADR-016/ADR-017 for the full harness architecture
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 iPod device (5G, classic, nano variants): checks[] includes orphan-files, artwork-rebuild, sysinfo-consistency; excludes orphan-files-mass-storage
- [ ] #2 iPod device output uses 'Database Health' section header in human mode and includes 'Device Readiness' section
- [ ] #3 echo-mini mass-storage device: checks[] includes orphan-files-mass-storage; excludes orphan-files, artwork-rebuild, artwork-reset, sysinfo-extended, sysinfo-consistency
- [ ] #4 echo-mini device output uses 'Device Health' section header (no readiness pipeline, no DB checks)
- [ ] #5 generic mass-storage preset: doctor runs cleanly when content paths are configured via per-device config; orphan check uses the configured paths
- [ ] #6 rockbox mass-storage preset: doctor runs cleanly using rockbox-specific content paths from preset defaults
- [ ] #7 Unsupported iPod (e.g. iOS-range product ID): readiness usb stage surfaces unsupportedReason; doctor exits with a clear error rather than running checks against an unsupported device
- [ ] #8 Mass-storage device with --repair targeting an iPod-only check (e.g. artwork-rebuild) fails clearly, exit 1, with explanatory message
- [ ] #9 iPod device with --repair targeting a mass-storage-only check (orphan-files-mass-storage) fails clearly, exit 1
- [ ] #10 deviceModel field in JSON: iPod resolves to model display name (e.g. 'iPod nano 4th generation 8GB Silver'); mass-storage resolves to preset display name (e.g. 'Echo Mini')
- [ ] #11 Device specified by config name (-d echomini) and by path (-d /Volumes/...) produce equivalent output for the same physical device fixture
- [ ] #12 Doctor against a path that is not a recognised device (random temp dir) fails with 'Device path not found' or readiness mount-stage failure
<!-- AC:END -->
