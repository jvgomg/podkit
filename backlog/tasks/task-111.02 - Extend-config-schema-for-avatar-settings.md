---
id: TASK-111.02
title: Extend config schema for avatar settings
status: To Do
assignee: []
created_date: '2026-03-11 15:19'
labels:
  - feature
  - config
dependencies: []
references:
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-cli/src/config/
parent_task_id: TASK-111
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add avatar configuration to the podkit config schema. Two areas of change:

**1. Global avatar settings** — new `[avatar]` section in config.toml:
```toml
[avatar]
enabled = true           # Master toggle (default: true)
theme = "auto"           # "auto" | "dark" | "light" (default: "auto")
```

**2. Per-device fields** — add optional fields to each device entry:
```toml
[devices.terapod]
avatarColor = "silver"   # Color name from palette
avatarModel = "classic"  # Model family override (normally auto-detected)
```

**TypeScript changes needed:**
- Add `AvatarConfig` interface: `{ enabled?: boolean; theme?: 'auto' | 'dark' | 'light' }`
- Add `avatar?: AvatarConfig` to the root `PodkitConfig` type
- Add `avatarColor?: string` and `avatarModel?: string` to `DeviceConfig`
- Update config parsing/validation to handle the new fields
- Update config writing to persist avatar choices

The config must remain backward-compatible — existing configs without avatar fields work fine with defaults (avatar enabled, theme auto, no color/model stored).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 AvatarConfig type added with enabled (boolean) and theme (auto/dark/light) fields
- [ ] #2 DeviceConfig extended with optional avatarColor and avatarModel fields
- [ ] #3 Config parser reads [avatar] section and per-device avatar fields from TOML
- [ ] #4 Config writer persists avatar settings back to TOML
- [ ] #5 Existing configs without avatar fields load successfully with sensible defaults
- [ ] #6 Validation rejects invalid theme values and unknown color names
<!-- AC:END -->
