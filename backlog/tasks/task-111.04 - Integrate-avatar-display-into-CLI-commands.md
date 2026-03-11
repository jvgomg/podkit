---
id: TASK-111.04
title: Integrate avatar display into CLI commands
status: To Do
assignee: []
created_date: '2026-03-11 15:20'
labels:
  - feature
  - cli
  - ux
dependencies:
  - TASK-111.01
  - TASK-111.02
  - TASK-111.03
references:
  - packages/podkit-cli/src/commands/device.ts
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/output/context.ts
  - packages/podkit-cli/src/utils/progress.ts
  - packages/podkit-cli/src/main.ts
parent_task_id: TASK-111
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire up avatar rendering from `@podkit/ipod-avatar` into the CLI commands that should display the iPod avatar.

**Integration points:**

| Command | When | Expression | Notes |
|---|---|---|---|
| `device info` | After status display | Neutral `(•‿•)` | Show avatar with device name label |
| `mount` | On successful mount | Happy `(◕‿◕)` | Brief display |
| `eject` | On successful eject | Sleepy `(–‿–) zzZ` | Brief display |
| `sync` in progress | Above progress bar | Syncing (animated) | Mini progress bar in screen reflects sync %. Avatar is persistent header, progress bar updates below |
| `sync` complete | Replace sync animation | Satisfied `(◕‿◕) ✓` | |
| `sync` error | Replace sync animation | Concerned `(•_•;)` | |

**Global suppression logic** (add to OutputContext or a new avatar helper):
- `--json` → no avatar
- `--quiet` → no avatar
- `!process.stdout.isTTY` → no avatar
- `NO_COLOR` set → render without color (outlines only)
- `--no-avatar` flag → no avatar
- Config `avatar.enabled = false` → no avatar

**New global flag:** `--no-avatar` added to the global options in main.ts.

**Sync animation integration:** The existing progress rendering in `packages/podkit-cli/src/utils/progress.ts` needs to be extended. The avatar should be printed once above the progress area and the screen content updated in-place as sync progresses. Use ANSI cursor movement to update just the screen region without redrawing the whole avatar.

**Dependencies:** Requires all three preceding subtasks (TASK-111.01 avatar package, TASK-111.02 config schema, TASK-111.03 color picker).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Avatar displays after device info output with neutral expression
- [ ] #2 Avatar displays on successful mount with happy expression
- [ ] #3 Avatar displays on successful eject with sleepy expression
- [ ] #4 Avatar displays above progress bar during sync with animated screen content
- [ ] #5 Avatar transitions to satisfied expression on sync complete
- [ ] #6 Avatar transitions to concerned expression on sync error
- [ ] #7 Avatar suppressed when --json, --quiet, non-TTY, NO_COLOR, --no-avatar, or config disabled
- [ ] #8 --no-avatar global flag registered and functional
- [ ] #9 Sync animation uses cursor movement to update screen region without full redraw
<!-- AC:END -->
