---
id: TASK-111.05
title: Design and implement ASCII art for all iPod model families
status: In Progress
assignee: []
created_date: '2026-03-11 15:31'
updated_date: '2026-03-11 23:26'
labels:
  - feature
  - design
  - new-package
dependencies:
  - TASK-111.01
references:
  - packages/podkit-core/src/ipod/generation.ts
documentation:
  - backlog/documents/doc-002 - ASCII-iPod-Avatar-Feature-Design.md
parent_task_id: TASK-111
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design the ASCII art templates for all 9 iPod model families, plus a preview/showcase script for iterating on the designs.

## Design Decisions (from experimentation)

### Body Style
Use **Approach 4** — compact body with a 2-line screen that the face fills fully. Unicode box-drawing for the outer shell (`╭╮╰╯│`), inner screen borders (`┌┐└┘`), and `▓` block fill for the colored body region.

### Wheel Sizes
Two wheel styles based on device size:

**Small wheel (A-style)** — for Nano, Mini:
```
╭────╮
│  ● │
╰────╯
```

**Large wheel (E-style)** — for Classic, Video:
```
·─────·
╭╯     ╰╮
│   ●   │
╰╮     ╭╯
·─────·
```

### Target Sizes
| Tier | Width | Height | Models |
|---|---|---|---|
| Large | ~14 chars | ~12 lines | Classic, Video, Unknown |
| Small | ~12 chars | ~10 lines | Nano (all), Mini |
| Tiny | ~8-10 chars | ~6-8 lines | Shuffle (no screen, no wheel) |
| Screenful | ~12-14 chars | ~10-12 lines | Touch (all screen, no wheel) |

### Expression Set (2-line faces, fill the screen)
All expressions use 2 lines inside the screen area:

**Neutral** (device info):
```
◕    ◕
 ╰──╯
```

**Happy** (mount):
```
◕    ◕
 ╰▽╯
```

**Excited** (device add):
```
★    ★
 ╰▽╯
```

**Sleepy** (eject):
```
─    ─
 ╰──╯    zzZ
```

**Concerned** (error):
```
◕    ◕
 ╭──╮
```

**Syncing** (sync in progress — progress bar replaces mouth):
```
◕    ◕
[████░░]
```

**Satisfied** (sync complete):
```
◕    ◕
 ╰▽╯  ✓
```

### Shuffle Special Case
No screen, no wheel. Expressions via speech/thought bubbles above or beside the body:
```
  ♪ ♫
 ╭───╮
 │   │
 ╰───╯
```

### Full Reference Examples

**iPod Video 5th Gen (large, neutral):**
```
╭────────────╮
│┌──────────┐│
││  ◕    ◕  ││
││   ╰──╯   ││
│└──────────┘│
│▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓·─────·▓▓│
│▓╭╯     ╰╮▓│
│▓│   ●   │▓│
│▓╰╮     ╭╯▓│
│▓▓·─────·▓▓│
╰────────────╯
   terapod
```

**Nano (small, neutral):**
```
╭──────────╮
│┌────────┐│
││ ◕    ◕ ││
││  ╰──╯  ││
│└────────┘│
│▓▓▓▓▓▓▓▓▓▓│
│▓▓╭────╮▓▓│
│▓▓│  ● │▓▓│
│▓▓╰────╯▓▓│
╰──────────╯
  nanopod
```

## Preview Script Requirements

Create a script (e.g. `packages/ipod-avatar/scripts/preview.ts`) runnable via `bun run preview` that provides two modes:

### Mode 1: Single iPod with flags
```bash
bun run preview --model classic --expression happy --color silver
bun run preview --model nano-tall --expression sleepy --color pink
bun run preview --model shuffle --expression syncing --color blue
```
Renders a single iPod with the given model, expression, and color. Should support `--all-expressions` to show all 7 expressions for a given model in a row, and `--all-models` to show all 9 models for a given expression.

### Mode 2: Gallery / "on a table"
```bash
bun run preview --gallery --expression neutral
bun run preview --gallery --expression happy --color red
```
Renders all iPod models side by side as if sat on a table:
- Detect terminal width (`process.stdout.columns`)
- Place iPods in a row with 2-3 chars spacing between them
- Bottom-align them (shorter iPods sit on the same baseline as taller ones)
- Wrap to next row if the next iPod would exceed terminal width
- Show device name/model label beneath each one

This script is the primary tool for iterating on the art during development.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ASCII art templates for all 7 supported model families: Classic/Video, Mini, Nano tall (1st-2nd), Nano short/fat (3rd), Nano slim (4th-5th), Shuffle (1st-2nd), Unknown
- [x] #2 Large wheel (E-style curved) used for Classic/Video/Unknown, small wheel (A-style box) used for Nano/Mini
- [x] #3 Shuffle has no screen — expressions use speech/thought bubbles
- [x] #4 All 7 expressions render correctly for screened models: neutral, happy, excited, sleepy, concerned, syncing (with progress bar), satisfied
- [x] #5 Shuffle expressions render via bubbles for all 7 moods
- [x] #6 Preview script runnable via `bun run preview` with --model, --expression, --color flags
- [x] #7 Preview script supports --all-expressions to show all expressions for one model
- [x] #8 Preview script supports --all-models to show all models for one expression
- [x] #9 Gallery mode (--gallery) renders all models side-by-side, bottom-aligned on a shared baseline
- [x] #10 Gallery mode detects terminal width and wraps iPods to next row when they won't fit
- [x] #11 Gallery mode shows model label beneath each iPod
- [x] #12 2-3 character spacing between iPods in gallery mode
- [x] #13 Color flag applies ANSI color to the body fill region
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Supported Model Families (based on docs/devices/supported-devices.md)

Only devices actually supported by libgpod/podkit get art. Unsupported devices (Touch, iPhone, iPad, Nano 6th-7th, Shuffle 3rd-4th) fall back to Unknown.

| Family | Generations | Physical Description |
|---|---|---|
| **Classic/Video** | first, second, third, fourth, photo, video_1, video_2, classic_1, classic_2, classic_3 | Large body, click wheel, small screen. Large E-style wheel. |
| **Mini** | mini_1, mini_2 | Smaller body, click wheel, narrow. Small A-style wheel. |
| **Nano tall** | nano_1, nano_2 | Thin and tall, click wheel. Small A-style wheel. |
| **Nano short** | nano_3 | Short, wide screen ("fat" design). Small A-style wheel. |
| **Nano slim** | nano_4, nano_5 | Very thin, tall, curved. Small A-style wheel. |
| **Shuffle** | shuffle_1, shuffle_2 | Tiny, no screen, no wheel. Speech/thought bubbles for expressions. |
| **Unknown** | unknown + all unsupported generations | Generic iPod silhouette. Large E-style wheel. |

Dropped from original plan:
- ~~Nano square (nano_6)~~ — Not supported by libgpod (different database format)
- ~~Touch~~ — Not supported (iOS sync protocol)
- No iPhone/iPad art needed
<!-- SECTION:NOTES:END -->
