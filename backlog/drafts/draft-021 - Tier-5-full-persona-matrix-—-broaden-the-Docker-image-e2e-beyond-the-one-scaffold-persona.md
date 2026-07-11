---
id: DRAFT-021
title: >-
  Tier-5 full persona matrix — broaden the Docker image e2e beyond the one
  scaffold persona
status: Draft
assignee: []
created_date: '2026-07-11 17:04'
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

TASK-451 scaffolded Tier-5 (Docker image e2e in the Lima VM) with ONE persona (`ipod-video-5g-iflash-1tb`) proving the wiring: image runs → `device add` (USB inquiry → SIE write) → real FLAC→AAC sync landing tracks in the iTunesDB. This task broadens that to the full matrix.

## What (Draft — scope when picked up)
- Add a **USB-native syncable FAT persona** (a new nano-3g/4g/5g variant with a FAT backing file) so the matrix isn't dependent on the video-5g "USB-inquiry fiction" (a real 5G Video uses SCSI inquiry; the scaffold serves its SIE over USB via the harness). This is the realism refinement deferred from TASK-451.
- Exercise more personas through the image: read-only/refusal generations (nano-7g access:none), mass-storage players (Echo Mini), and error paths (identity mismatch, malformed SIE).
- Parameterize the Tier-5 test (from TASK-451 M6) over a persona set rather than one hardcoded persona.
- Consider the daemon steady-state path (long-running `daemon` in the container) in addition to one-shot `sync`.

## Depends on
- TASK-451 (the scaffold + the `test:tier5` harness) landing first.

## Known constraints (from TASK-451)
- macOS Docker Desktop can't pass USB → runs inside the Linux VM only.
- Container needs PUID=0 + `--device /dev/sdX` for block-device UUID; PATH-based device addressing (UUID resolution fails in-container).
- video-5g backing ships a stale on-disk SIE that mismatches live inquiry → start from clean SIE.
<!-- SECTION:DESCRIPTION:END -->
