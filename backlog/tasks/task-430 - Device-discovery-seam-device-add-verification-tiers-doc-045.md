---
id: TASK-430
title: Device discovery seam + device add verification tiers (doc-045)
status: Done
assignee: []
created_date: '2026-06-21 09:26'
updated_date: '2026-06-21 14:39'
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

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All 8 subtasks delivered (doc-045). Two coordinated changes shipped on branch `feat/device-scan-locate-seam`:

1. **Core discovery seam** — `DeviceManager.listDevices/findIpodDevices/findByVolumeUuid/getUuidForMountPoint` deleted and replaced by `scan({ kinds? })` (enumerate) + `locate({ volumeUuid | path })` (first real direct single-target lookup: macOS `diskutil info`, Linux `findmnt`/`blkid -U`). Resolvers/orchestrators rebased; disguised enumerate+.find collapses removed.

2. **`device add` verification tiers** — runDeviceAdd thinned onto two pure decision modules (M3 resolveAddRequest, M4 decideAddOutcome) with kind-agnostic assessment views. Three tiers: default verify (live sysinfo cross-check), `--no-verify` (trust on-disk SysInfo, required), `--no-validate` (config-inject, zero device I/O). `--no-firmware-inquiry` renamed `--no-verify` (breaking → minor); only `--force` bypasses empty-identity now; JSON `verification` field. Env-var test hatch (`PODKIT_TEST_SYNTHETIC_VOLUME_UUID`/`synthesizeTestVolumeUuid`) removed, e2e migrated to `--no-validate`. CLI iPod-vs-mass-storage label leakage collapsed onto `DeviceDisplay`.

Gates: lint 0/0; build 19/19; core 3188 + CLI 1721 unit + 67 integration pass; host e2e 33/0 (483s). NOT RUN (need Lima/Docker): VM `--no-verify` persona cases + `volume-uuid-defensive` rewrite (`test:vm`); Docker contract test (`test:e2e:docker`).

Open risk (documented, not solved): Docker-SCSI gap — see doc-046 + the adding-devices.md #docker-scsi-gap callout.

Committed in 6 logical commits; supersedes archived TASK-344.

POST-COMPLETION FIXES (found by the user running test:vm + test:e2e:docker): three regressions fixed in commit 255e5904. (1) locate({path}) used findmnt --target / diskutil info which resolve a non-mountpoint sub-path to its ENCLOSING mount — restored exact-mountpoint matching on both platforms (the no-UUID gate now fires correctly for scratch paths); per-platform unit tests added. (2) reachByScan mounted an unmounted HFS+ iPod before the filesystem refusal — moved the refusal before the mount block; unmounted-device unit test added (asserts mount() never called). (3) Docker mass-storage test used --volume-uuid (mass-storage needs --path) and asserted the iPod renderer string — both fixed. Verified: lint 0/0, core 3190, CLI 1723 unit + 67 integration, host e2e 33/0, e2e:docker 4 pass/2 skip/0 fail. The two VM regressions are now also covered by host-runnable unit tests. The original VM run's 2 failures were real; an additional host-e2e run showed 3 transient failures traced to 24 orphaned Subsonic containers starving the parallel suite (both files pass in isolation; clean re-run 33/0).
<!-- SECTION:FINAL_SUMMARY:END -->
