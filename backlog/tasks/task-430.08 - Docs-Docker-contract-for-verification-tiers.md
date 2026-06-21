---
id: TASK-430.08
title: Docs + Docker contract for verification tiers
status: Done
assignee: []
created_date: '2026-06-21 09:28'
updated_date: '2026-06-21 12:26'
labels:
  - docs
  - device-add
  - docker
milestone: m-18
dependencies:
  - TASK-430.05
  - TASK-430.06
references:
  - doc-045 - PRD-Device-discovery-seam-device-add-verification-tiers.md
parent_task_id: TASK-430
ordinal: 153000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Document the verification tiers and pin the Docker contract (doc-045).

- Add a "headless / automation" section to `docs/user-guide/devices/adding-devices.md`: when to use `--no-verify` vs `--no-validate`, the replug-following trade-off (path-only vs `--volume-uuid`), and a worked Docker / headless-server example.
- Add a gated `device-add.docker.test.ts` pinning the `--no-verify` / `--no-validate` Docker contract.
- Capture the **Docker-SCSI open risk** prominently (in docs and/or a backlog rough-edges note): a Docker user whose mounted iPod has no on-disk SysInfo is told to run `podkit doctor`, but doctor needs SCSI/USB inquiry that may be unavailable in-container; checksum-based generations cannot sync without SysInfoExtended written somewhere. Document the "run doctor on an SCSI-capable host once" workflow as the current recommendation; note synthesize-from-`--type` as a candidate future direction. This task does NOT solve the gap.

Parent: TASK-430. Design: doc-045 (Further Notes — Docker SCSI gap).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `adding-devices.md` has a headless/automation section covering `--no-verify` vs `--no-validate`, the replug trade-off, and a worked Docker example
- [x] #2 A gated `device-add.docker.test.ts` pins the `--no-verify` / `--no-validate` Docker contract
- [x] #3 The Docker-SCSI gap is documented as a known limitation with the 'run doctor on an SCSI-capable host' workflow and the synthesize-from-`--type` candidate noted
- [x] #4 Docs-site build passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by sonnet worker + team-lead verification. Added a 'Headless / Automation' section to docs/user-guide/devices/adding-devices.md: decision table (default / --no-verify / --no-validate), the replug trade-off (--volume-uuid vs path-only), worked Docker (--no-verify --path) + provisioning (--no-validate) examples, and a Starlight :::caution Docker-SCSI-gap callout (#docker-scsi-gap anchor). New rough-edges doc backlog/docs/doc-046 capturing the unsolved Docker-SCSI gap (problem, per-tier behaviour, run-doctor-on-SCSI-host workflow, synthesize-from-type candidate). New gated test-packages/e2e-tests/src/commands/device-add.docker.test.ts: 4 --no-validate assertions (uuid add zero-dep, verification=config-only, mass-storage add, incomplete-identity reject) + 2 skip-stubs for --no-verify with SCSI-gap comments; skip-gated via isDockerAvailable() like other *.docker.test.ts, excluded from host test:e2e. Verified: docs examples use valid flags (--type ipod is accepted; knownDeviceTypeIds=['ipod',...presets]). Gates: lint 0/0, build 19/19, e2e-tests typecheck clean, docs-site vite build ✓. NOT RUN HERE: test:e2e:docker (needs Docker).
<!-- SECTION:NOTES:END -->
