---
id: TASK-430.08
title: Docs + Docker contract for verification tiers
status: To Do
assignee: []
created_date: '2026-06-21 09:28'
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
- [ ] #1 `adding-devices.md` has a headless/automation section covering `--no-verify` vs `--no-validate`, the replug trade-off, and a worked Docker example
- [ ] #2 A gated `device-add.docker.test.ts` pins the `--no-verify` / `--no-validate` Docker contract
- [ ] #3 The Docker-SCSI gap is documented as a known limitation with the 'run doctor on an SCSI-capable host' workflow and the synthesize-from-`--type` candidate noted
- [ ] #4 Docs-site build passes
<!-- AC:END -->
