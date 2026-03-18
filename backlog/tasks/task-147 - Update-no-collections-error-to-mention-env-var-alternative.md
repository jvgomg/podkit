---
id: TASK-147
title: Update "no collections" error to mention env var alternative
status: To Do
assignee: []
created_date: '2026-03-18 02:40'
labels:
  - ux
dependencies: []
references:
  - 'packages/podkit-cli/src/commands/sync.ts:1445'
  - 'packages/podkit-cli/src/commands/collection.ts:108'
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The sync command's error message when no collections are configured only mentions the config file. Now that collections can be defined via env vars (PODKIT_MUSIC_PATH etc.), the error should mention both options.

**Current:** "No collections configured to sync. Add collections to your config file..."
**Proposed:** Add "Or set PODKIT_MUSIC_PATH via environment variable." after the config file instructions.

Also check `collection.ts` line 108 which has a similar message.
<!-- SECTION:DESCRIPTION:END -->
