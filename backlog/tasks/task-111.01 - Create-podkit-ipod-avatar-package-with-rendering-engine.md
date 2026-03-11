---
id: TASK-111.01
title: Create @podkit/ipod-avatar package with rendering engine
status: To Do
assignee: []
created_date: '2026-03-11 15:19'
updated_date: '2026-03-11 16:27'
labels:
  - feature
  - new-package
dependencies: []
references:
  - packages/podkit-core/src/ipod/generation.ts
documentation:
  - backlog/documents/doc-002 - ASCII-iPod-Avatar-Feature-Design.md
parent_task_id: TASK-111
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the new `@podkit/ipod-avatar` package under `packages/ipod-avatar/`. This is the core rendering package with zero runtime dependencies.

It needs:
1. **Art templates** for 7 supported model families: Classic/Video, Mini, Nano tall (1st-2nd), Nano short (3rd), Nano slim (4th-5th), Shuffle (1st-2nd), Unknown. Target ~10-12 lines tall, 12-14 chars wide. Each template defines regions for screen, body, and wheel/buttons. Unsupported generations (nano_6, shuffle_3, shuffle_4, touch_*, iphone_*, ipad_*, mobile) map to Unknown.
2. **Color system** (`colors.ts`): ANSI 256-color mappings for the palette (Silver, White, Black, Pink, Blue, Green, Gold, Red, Purple, Orange, Yellow). Colors apply to the body region.
3. **Expression system** (`expressions.ts`): Mood definitions (neutral, excited, happy, sleepy, syncing, satisfied, concerned). For screen-based models, expressions render as 2-line faces inside the screen area. For Shuffle, expressions use speech/thought bubbles above or beside the device.
4. **Render compositing** (`render.ts`): Takes a model template + color + expression + theme and produces an array of styled strings. Also provides `renderSyncFrames()` that generates animation frames with a mini progress bar in the screen area.
5. **Terminal detection** (`terminal.ts`): Detect dark/light background via OSC 11, COLORFGBG env, TERM_PROGRAM heuristic, fallback to dark. Contrast compensation: add outlines for dark-on-dark (black iPod, dark terminal) and light-on-light (white iPod, light terminal).
6. **Types** (`types.ts`): `IpodModelFamily`, `AvatarColor`, `Expression`, theme types.
7. **Public API** (`index.ts`): Export `renderAvatar()`, `renderSyncFrames()`, `getAvailableColors()`, `generationToModelFamily()`.

Art style: experiment freely with Unicode box-drawing, block characters, or ASCII lines. Assume modern terminal support — no fallback styles needed. The art should be distinctive per model family and look charming.

See design document doc-002 for the full specification including supported device matrix, art design decisions, and API signatures.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Package scaffolded at packages/ipod-avatar/ with package.json, tsconfig.json, workspace dependency in root
- [ ] #2 ASCII art templates exist for all 7 supported model families, each visually distinctive
- [ ] #3 Color palette with 11 colors maps to ANSI escape codes and applies to body region
- [ ] #4 7 expression types render correctly in screen area (or bubbles for Shuffle)
- [ ] #5 renderAvatar() returns styled string array for static display
- [ ] #6 renderSyncFrames() returns animation frames with progress indicator
- [ ] #7 Terminal background detection works via OSC 11 / COLORFGBG / heuristic / fallback
- [ ] #8 Contrast compensation adds outlines for dark-on-dark and light-on-light scenarios
- [ ] #9 generationToModelFamily() maps all supported generation strings from libgpod to correct model family
- [ ] #10 Unsupported generations (nano_6, shuffle_3, shuffle_4, touch_*, iphone_*, ipad_*) map to Unknown family
- [ ] #11 Unit tests cover rendering, color application, expression compositing, and generation mapping
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-111.05 handles the detailed art design and preview script. This task should focus on the package scaffolding, rendering engine, color system, terminal detection, and expression compositing infrastructure. The art templates created here can be initial/placeholder versions — TASK-111.05 will refine them with the preview script as the iteration tool.
<!-- SECTION:NOTES:END -->
