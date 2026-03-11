---
id: TASK-111.03
title: Add interactive color picker to device add flow
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
references:
  - packages/podkit-cli/src/commands/device.ts
parent_task_id: TASK-111
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Enhance the `device add` command with an interactive color picker for the iPod avatar.

**New dependency:** Add `@clack/prompts` to podkit-cli.

**Flow changes to `device add`:**
1. After detecting the iPod and showing model info (existing behavior)
2. If TTY and avatar enabled: present color picker using `@clack/prompts` select prompt
3. Show color options with visual swatches (colored blocks) for each available color
4. After selection, render a preview of the full avatar with the chosen color and excited expression
5. Confirm selection
6. Store `avatarColor` and auto-detected `avatarModel` (mapped from generation) in device config
7. Continue with existing confirmation flow

**Non-interactive fallback:**
- Add `--avatar-color <name>` flag to `device add`
- If not a TTY and no --avatar-color provided, skip avatar setup entirely (no error, just no avatar config stored)
- If --avatar-color provided, validate the color name and store it without interactive prompt

**Dependencies:** Requires the @podkit/ipod-avatar package (TASK-111.01 for renderAvatar, getAvailableColors, generationToModelFamily) and config schema changes (TASK-111.02 for storing avatar fields).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 @clack/prompts added as dependency to podkit-cli
- [ ] #2 Interactive color picker appears during device add on TTY terminals
- [ ] #3 Color swatches display with colored blocks next to each option
- [ ] #4 After selection, a preview of the avatar with chosen color is shown
- [ ] #5 avatarColor and avatarModel are persisted to device config
- [ ] #6 --avatar-color flag works for non-interactive device add
- [ ] #7 Avatar setup gracefully skipped when not TTY and no --avatar-color flag
- [ ] #8 Existing device add flow unchanged when avatar is disabled in config
<!-- AC:END -->
