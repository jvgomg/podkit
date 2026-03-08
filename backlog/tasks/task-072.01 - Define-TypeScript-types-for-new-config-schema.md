---
id: TASK-072.01
title: Define TypeScript types for new config schema
status: To Do
assignee: []
created_date: '2026-03-08 23:46'
labels:
  - config
  - types
dependencies: []
parent_task_id: TASK-072
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define the TypeScript interfaces for the new config structure:

- `MusicCollectionConfig` (path, type, subsonic options)
- `VideoCollectionConfig` (path)
- `DeviceConfig` (volumeUuid, volumeName, quality, videoQuality, artwork, transforms)
- `DefaultsConfig` (music, video, device)
- Updated `PodkitConfig` with music, video, devices, defaults sections

Location: `packages/podkit-cli/src/config/types.ts`
<!-- SECTION:DESCRIPTION:END -->
