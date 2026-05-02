---
id: TASK-150
title: Lima VM infrastructure (Debian + Alpine)
status: Done
assignee: []
created_date: '2026-03-18 12:24'
updated_date: '2026-03-18 13:04'
labels:
  - infra
  - testing
  - linux
milestone: Linux Device Manager
dependencies: []
references:
  - tools/
  - docker/Dockerfile
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add Lima VM configurations for cross-platform development and testing.

Two VMs:
- **Debian 12 (Bookworm)** — matches Homebrew/native Linux users
- **Alpine 3.21** — matches Docker image base

Each VM provisioned with: Bun, Node.js, FFmpeg, libgpod-dev, GLib, build tools (gcc/g++/make/python3), util-linux, node-gyp, gpod-tool.

Lima configs in `tools/lima/`. Provisioning scripts install all dependencies so `bun install && bun run test` works inside the VM.

Part of the LinuxDeviceManager milestone but independent of implementation work — can proceed in parallel.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Lima YAML config exists for Debian 12 in tools/lima/
- [ ] #2 Lima YAML config exists for Alpine 3.21 in tools/lima/
- [ ] #3 Provisioning installs Bun, Node.js, FFmpeg, libgpod-dev, GLib, build tools, util-linux
- [ ] #4 bun install succeeds inside Debian VM
- [ ] #5 bun install succeeds inside Alpine VM
- [ ] #6 bun run test passes inside Debian VM
- [ ] #7 bun run test passes inside Alpine VM
- [ ] #8 gpod-tool builds inside both VMs
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Lima configs created at tools/lima/. Awaiting user validation with limactl start.
<!-- SECTION:NOTES:END -->
