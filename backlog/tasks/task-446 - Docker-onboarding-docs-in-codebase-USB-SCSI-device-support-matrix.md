---
id: TASK-446
title: Docker onboarding docs + in-codebase USB/SCSI device-support matrix
status: Done
assignee: []
created_date: '2026-06-27 19:04'
updated_date: '2026-07-07 23:12'
labels:
  - docker
  - docs
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - docs/getting-started/docker.md
  - docs/getting-started/docker-daemon.md
modified_files:
  - documents/architecture/device/identity-support-matrix.md
  - documents/architecture/README.md
  - docs/getting-started/docker.md
  - docs/getting-started/docker-daemon.md
  - docs/devices/troubleshooting.md
  - agents/docker.md
  - packages/ipod-firmware/src/inquiry/selection.ts
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the onboarding model explicit and honest in the docs, and establish the device-support boundary as a source of truth.

User docs: the onboarding runbook organised around the setup-vs-steady-state spine (path baseline + one-time USB setup); canonical `docker run`/compose recipes per path; the daemon config-mode matrix (ENV = single device; config = multiple/differentiated; mass-storage needs declared preset); the udev-irrelevance note; a `doctor` example.

In-codebase: the exact USB/SCSI device-support matrix — which iPod generations resolve from on-disk identity vs need the one-time USB setup, which need the SCSI fallback (unsupported in-container today), and how mass-storage (preset-based, no inquiry) fits.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Onboarding runbook documents path-baseline + one-time-USB-setup, organised around setup vs steady-state
- [x] #2 Canonical docker run/compose recipes documented for one-shot and daemon, per onboarding path
- [x] #3 Daemon config-mode matrix documented (ENV vs config; mass-storage preset requirement)
- [x] #4 udev-rule-irrelevance-inside-container note added
- [x] #5 doctor example added to Docker docs
- [x] #6 In-codebase USB/SCSI device-support matrix written and linked from agents/docker.md
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Handoff note: some onboarding docs already landed in sibling m-22 tasks — avoid duplicating, extend/link instead. Already done: docs/devices/troubleshooting.md has the 'Could not identify this iPod model' remediation (one-time USB setup via `device add` + `doctor --repair sysinfo-extended`) from TASK-440; agents/docker.md documents the runtime-derived entrypoint command list (439), the bats entrypoint tests (448), and the Tier-3 image smoke (449); documents/architecture/sync/error-handling.md §6 documents the unknown-model pre-flight guard. Still to write per doc-052: the in-codebase USB/SCSI device-support matrix, the path-baseline vs one-time-USB-setup onboarding runbook, daemon config-mode matrix, canonical docker run/compose recipes per path, and the udev-irrelevance note.

Implemented. AC#6: new documents/architecture/device/identity-support-matrix.md — identity cascade (as resolveIpodModel actually orders it: on-disk modelNumStr → serial suffix → USB PID → familyId; libgpodGeneration noted as open-device-only fallback), pre/post-2006 on-disk identity writers, per-generation USB/SCSI transport matrix (nano 3G = first USB-capable; video 5G/5.5G + nano 1G/2G + mini + 4G/Photo + shuffle 1G/2G SCSI-only → not settable-up in-container until TASK-296; nano 6G read-only vs 7G none kept distinct), per-environment lane table, conventions, references — links device-identification.md/test-devices.md/generations.ts rather than duplicating. Indexed in architecture README; linked from agents/docker.md with an update-in-same-PR convention.

AC#1/#2/#4/#5: docs/getting-started/docker.md gained 'Device Setup vs Steady-State' (path baseline vs one-time USB setup; canonical `device add -d <name> --path /ipod` recipe with --device /dev/bus/usb; SCSI-only-generations host caveat; udev-irrelevance note) and 'Checking a Device with doctor' (doctor -d /ipod + doctor -d /ipod --repair sysinfo-extended recipes; startup Device access report pointer). AC#3: docker-daemon.md 'Which mode do I need?' matrix (ENV single iPod / ENV single mass-storage / config multi-iPod by UUID / config multi mass-storage by path + declared-preset rule).

Sonnet accuracy review caught 2 blockers before commit: (1) `doctor --repair` hard-requires explicit -d (doctor.ts DEVICE_REQUIRED; entrypoint only injects --device for sync) — both doctor recipes now pass -d /ipod, and the pre-existing troubleshooting.md remediation was aligned; (2) `device add -d <name>` without --path goes through lsblk scan, which non-privileged containers can't do — recipe now uses --path /ipod (the container-designed reachByPath route). Also applied: cascade-order corrections, nano-5G richer-USB-payload threshold (+ selection.ts TSDoc drive-by), 'stalls'→'does not respond' evidence wording, nano 1G untested note, agents/docker.md daemon-passthrough claim corrected to privileged-only. No changeset — docs + one comment; no distributed-package behavior change. Root lint + ipod-firmware typecheck green.
<!-- SECTION:NOTES:END -->
