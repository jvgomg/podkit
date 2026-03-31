---
id: TASK-260
title: Per-device default collection assignments
status: To Do
assignee: []
created_date: '2026-03-31 12:56'
labels:
  - enhancement
  - config
milestone: m-14
dependencies: []
references:
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-cli/src/commands/sync.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Users should be able to assign default music and video collections per device, not just globally. Currently the `[defaults]` section only supports one global default per content type.

Discovered during Echo Mini E2E validation (TASK-226). When syncing different collections to different devices (e.g., test collection to Echo Mini, navidrome to iPod), users must pass `-c <name>` every time.

**Proposed config:**
```toml
[devices.echomini]
type = "echo-mini"
path = "/Volumes/Echo SD"
defaultMusic = "local_music"

[devices.terapod]
volumeUuid = "..."
defaultMusic = "navidrome"
```

**Resolution order:** CLI flag > per-device default > global default
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 DeviceConfig supports optional defaultMusic and defaultVideo fields
- [ ] #2 Collection resolution uses per-device default when no -c flag is passed
- [ ] #3 Global [defaults] section still works as fallback when no per-device default is set
- [ ] #4 podkit device info shows the per-device default collection if set
<!-- AC:END -->
