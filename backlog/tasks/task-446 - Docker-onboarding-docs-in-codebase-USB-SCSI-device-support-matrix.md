---
id: TASK-446
title: Docker onboarding docs + in-codebase USB/SCSI device-support matrix
status: To Do
assignee: []
created_date: '2026-06-27 19:04'
labels:
  - docker
  - docs
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - docs/getting-started/docker.md
  - docs/getting-started/docker-daemon.md
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
- [ ] #1 Onboarding runbook documents path-baseline + one-time-USB-setup, organised around setup vs steady-state
- [ ] #2 Canonical docker run/compose recipes documented for one-shot and daemon, per onboarding path
- [ ] #3 Daemon config-mode matrix documented (ENV vs config; mass-storage preset requirement)
- [ ] #4 udev-rule-irrelevance-inside-container note added
- [ ] #5 doctor example added to Docker docs
- [ ] #6 In-codebase USB/SCSI device-support matrix written and linked from agents/docker.md
<!-- AC:END -->
