---
id: DRAFT-021
title: >-
  Tier-5 full persona matrix — broaden the Docker image e2e beyond the one
  scaffold persona
status: Draft
assignee: []
created_date: '2026-07-11 17:04'
updated_date: '2026-07-11 20:05'
labels:
  - docker
  - testing
  - vm
  - tier-5
milestone: m-22
dependencies:
  - TASK-451
references:
  - test-packages/e2e-vm-tests/
  - test-packages/device-testing/src/personas/
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

TASK-451 scaffolded Tier-5 (Docker image e2e in the Lima VM) with ONE persona (`ipod-video-5g-iflash-1tb`) proving the wiring: image runs → `device add` (USB inquiry → SIE write) → real FLAC→AAC sync landing tracks → daemon steady-state auto-sync. This task broadens that to the full matrix.

## What (Draft — scope when picked up)
- Add a **USB-native syncable FAT persona** (a new nano-3g/4g/5g variant with a FAT backing file) so the matrix isn't dependent on the video-5g "USB-inquiry fiction" (a real 5G Video uses SCSI inquiry; the scaffold serves its SIE over USB via the harness). This is the realism refinement deferred from TASK-451.
- **Ship a PARTITIONED persona backing** (MBR whose data volume is a `type=part` FAT partition, like real iPod hardware) so the daemon's **iPod (lsblk) detection lane** is exercised in Tier 5. TASK-451's daemon test could only drive the daemon's *mass-storage* lane because the current bare-FAT backing (`truncate` + `mkfs.vfat`, no partition table) presents as `type=disk`, which the lsblk lane skips. See TASK-465 for the complementary product-side decision (whether the lsblk lane should also accept whole-disk vfat).
- Exercise more personas through the image: read-only/refusal generations (nano-7g access:none), mass-storage players (Echo Mini), and error paths (identity mismatch, malformed SIE).
- Parameterize the Tier-5 tests (from TASK-451) over a persona set rather than one hardcoded persona.

## Depends on
- TASK-451 (the scaffold + the `test:e2e:docker-dist` harness, now in `src/docker-dist/`) landing first.

## Known constraints (from TASK-451)
- macOS Docker Desktop can't pass USB → runs inside the Linux VM only.
- Container needs PUID=0 + `--device /dev/sdX` for block-device UUID; PATH-based device addressing (volumeUuid resolution fails in-container → DEVICE_PATH_UNRESOLVED).
- The synthesized backing is an EMPTY FAT (no iPod_Control/iTunesDB) — seed with `gpod-tool init --model <M>` before syncing (else IPOD_NEEDS_INIT). Wipe any on-disk SysInfoExtended before `device add` so the USB inquiry writes it fresh.
- `device add` persists the device entry keyed by volumeUuid (unusable in-container) → overwrite with a path-based `[devices.*]` entry for sync.
<!-- SECTION:DESCRIPTION:END -->
