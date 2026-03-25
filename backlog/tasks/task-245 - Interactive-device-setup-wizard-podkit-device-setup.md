---
id: TASK-245
title: Interactive device setup wizard (podkit device setup)
status: To Do
assignee: []
created_date: '2026-03-25 01:47'
labels:
  - feature
  - cli
  - ux
milestone: "Mass Storage Device Support: Extended"
dependencies:
  - TASK-224
references:
  - packages/podkit-cli/src/commands/device.ts
  - backlog/docs/doc-020 - Architecture--Multi-Device-Support-Decisions.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement an interactive `podkit device setup` wizard that guides users through configuring a new device.

**Flow:**
1. List connected removable volumes
2. Attempt auto-detection (iPod probe, USB ID matching, filesystem markers)
3. If auto-detected: "Found Echo Mini at /Volumes/ECHO_MINI — correct?" → persist
4. If not auto-detected: show list of supported device types, let user select → persist
5. Optionally allow capability overrides for power users

**Context:** Split from TASK-224 which implemented config schema, presets, and device resolver (AC #1-4, #7). The wizard (AC #5-6) was deferred as it requires interactive UX design decisions. Currently users can configure devices manually via `podkit device add --type`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 podkit device setup wizard implemented with auto-detect → confirm → persist flow
- [ ] #2 Wizard falls back to manual device type selection when auto-detection fails
- [ ] #3 Echo Mini dual-volume handling: wizard distinguishes internal vs SD card and lets user choose
- [ ] #4 Persisted config matches the schema from TASK-224 (type, path, optional capability overrides)
<!-- AC:END -->
