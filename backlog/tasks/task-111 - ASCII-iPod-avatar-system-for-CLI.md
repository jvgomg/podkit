---
id: TASK-111
title: ASCII iPod avatar system for CLI
status: In Progress
assignee: []
created_date: '2026-03-11 15:19'
updated_date: '2026-03-11 23:25'
labels:
  - feature
  - cli
  - ux
dependencies: []
documentation:
  - backlog/documents/doc-002 - ASCII-iPod-Avatar-Feature-Design.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add visual personality to the CLI by displaying ASCII art iPod avatars that represent the user's device. Each iPod model family gets a distinctive ASCII representation with user-chosen colors and contextual expressions (happy on mount, sleepy on eject, animated during sync).

This involves creating a new `@podkit/ipod-avatar` package for rendering logic, extending the config schema for avatar settings, adding an interactive color picker to `device add`, and integrating avatar display into key CLI commands.

See design document doc-002 for full specification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ASCII iPod avatars display for all 7 supported model families (Classic/Video, Mini, Nano tall, Nano short, Nano slim, Shuffle, Unknown)
- [ ] #2 Users can pick a color for their iPod during `device add` via interactive prompt
- [ ] #3 Avatar color and model family are stored in device config
- [ ] #4 Avatars show contextual expressions: neutral (info), excited (add), happy (mount), sleepy (eject), syncing (sync), satisfied (sync complete), concerned (sync error)
- [ ] #5 Shuffle uses speech/thought bubbles instead of screen expressions
- [ ] #6 Avatar automatically suppressed for --json, --quiet, non-TTY, and NO_COLOR
- [ ] #7 Global --no-avatar flag and config toggle to disable
- [ ] #8 Terminal background detection with contrast compensation for dark-on-dark and light-on-light
- [ ] #9 Non-interactive fallback: --avatar-color flag for scripted device add, gracefully skipped if absent
<!-- AC:END -->
