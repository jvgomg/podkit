---
id: doc-002
title: ASCII iPod Avatar Feature Design
type: other
created_date: '2026-03-11 15:18'
updated_date: '2026-03-11 16:27'
---
# ASCII iPod Avatar Feature Design

## Overview

Add visual personality to the CLI by displaying ASCII art iPod avatars that represent the user's device. Each iPod model family gets a distinctive ASCII representation. Users choose a color during `device add`, and the avatar shows contextual expressions (happy on mount, sleepy on eject, animated during sync).

## Supported Devices

**Only devices supported by libgpod/podkit get dedicated art.** Unsupported devices (Touch, iPhone, iPad, Nano 6th-7th, Shuffle 3rd-4th) fall back to the Unknown/generic family. See `docs/devices/supported-devices.md` for the full compatibility matrix.

### 7 Model Families

| Family | Generations Mapped | Distinctive Shape | Wheel |
|---|---|---|---|
| **Classic/Video** | first, second, third, fourth, photo, video_1, video_2, classic_1, classic_2, classic_3 | Large body, click wheel, small screen | Large (E-style) |
| **Mini** | mini_1, mini_2 | Smaller body, click wheel, narrow | Small (A-style) |
| **Nano tall** | nano_1, nano_2 | Thin and tall, click wheel | Small (A-style) |
| **Nano short** | nano_3 | Short, wide screen ("fat" design) | Small (A-style) |
| **Nano slim** | nano_4, nano_5 | Very thin, tall, curved | Small (A-style) |
| **Shuffle** | shuffle_1, shuffle_2 | Tiny, no screen, no wheel | None (speech/thought bubbles) |
| **Unknown** | unknown + all unsupported generations | Generic iPod silhouette | Large (E-style) |

**Not included** (unsupported by libgpod):
- ~~Nano square (nano_6)~~ — Different database format
- ~~Touch (touch_1–4)~~ — iOS sync protocol
- ~~iPhone (iphone_1–4)~~ — iOS sync protocol
- ~~iPad (ipad_1)~~ — iOS sync protocol
- ~~Shuffle 3rd/4th~~ — Require iTunes authentication hash

### Generation-to-Family Mapping

Unsupported generations (`nano_6`, `shuffle_3`, `shuffle_4`, `touch_*`, `iphone_*`, `ipad_*`, `mobile`) map to the **Unknown** family as a graceful fallback.

## Decisions Made

- **Prompt library**: `@clack/prompts` for the interactive color picker
- **Shuffle handling**: Shuffles have no screen — use speech/thought bubbles for expressions instead of screen content
- **Sync animation placement**: Avatar sits above the progress bar as a persistent header
- **Model storage**: Store detected model family in config so avatar works even when device is unmounted; re-detect when mounted to stay current
- **Non-interactive fallback**: If not a TTY and no `--avatar-color` flag provided, skip avatar setup during `device add`
- **Art style**: Experiment freely with ASCII lines, Unicode box-drawing, or pixelated block characters. Assume modern terminal support. No need for multiple fallback styles.
- **Body style**: Approach 4 — compact body with a 2-line screen that the face fills fully. Unicode box-drawing for outer shell, inner screen borders, and `▓` block fill for colored body region.

## Art Design

### Wheel Styles

**Small wheel (A-style)** — for Nano, Mini:
```
╭────╮
│  ● │
╰────╯
```

**Large wheel (E-style)** — for Classic, Video, Unknown:
```
  ·─────·
╭╯       ╰╮
│    ●    │
╰╮       ╭╯
  ·─────·
```

### Target Sizes

| Tier | Width | Height | Models |
|---|---|---|---|
| Large | ~14 chars | ~12 lines | Classic/Video, Unknown |
| Small | ~12 chars | ~10 lines | Nano (all), Mini |
| Tiny | ~8-10 chars | ~6-8 lines | Shuffle |

### Expression Set (2-line faces)

All expressions use 2 lines inside the screen area:

| Expression | Context | Eyes | Mouth | Extra |
|---|---|---|---|---|
| Neutral | `device info` | `◕    ◕` | ` ╰──╯ ` | |
| Happy | `mount` | `◕    ◕` | ` ╰▽╯ ` | |
| Excited | `device add` | `★    ★` | ` ╰▽╯ ` | |
| Sleepy | `eject` | `─    ─` | ` ╰──╯ ` | `zzZ` beside |
| Concerned | sync error | `◕    ◕` | ` ╭──╮ ` | |
| Syncing | sync progress | `◕    ◕` | `[████░░]` | Progress bar as mouth |
| Satisfied | sync complete | `◕    ◕` | ` ╰▽╯ ` | `✓` beside |

### Shuffle Expressions

Shuffles have no screen. Expressions appear as speech/thought bubbles above or beside the body:
```
  ♪ ♫
 ╭───╮
 │   │
 ╰───╯
```

### Reference Art

**iPod Video 5th Gen (large, neutral, with color fill):**
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

**Nano (small, neutral, with color fill):**
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

The `▓` regions are where the device color is applied as ANSI background color.

## New Package: `@podkit/ipod-avatar`

Standalone package with zero runtime dependencies (ANSI escape codes only).

### Package Structure

```
packages/ipod-avatar/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Public API
│   ├── models/               # ASCII art definitions per model family
│   │   ├── classic.ts        # Classic, Video, 1st-gen through classic_3
│   │   ├── mini.ts           # mini_1, mini_2
│   │   ├── nano-tall.ts      # nano_1, nano_2
│   │   ├── nano-short.ts     # nano_3
│   │   ├── nano-slim.ts      # nano_4, nano_5
│   │   ├── shuffle.ts        # shuffle_1, shuffle_2
│   │   └── unknown.ts        # Fallback generic silhouette
│   ├── colors.ts             # Color palette & ANSI mapping
│   ├── expressions.ts        # Mood/face definitions + bubble system for Shuffle
│   ├── render.ts             # Compositing engine (art + color + expression)
│   ├── terminal.ts           # Background detection, theme logic
│   └── types.ts              # Shared types
├── scripts/
│   └── preview.ts            # Preview/gallery script for iterating on art
└── test/
    ├── render.test.ts
    ├── colors.test.ts
    ├── expressions.test.ts
    └── terminal.test.ts
```

### Public API

```typescript
function renderAvatar(options: {
  model: IpodModelFamily;
  color: AvatarColor;
  expression: Expression;
  theme?: 'dark' | 'light' | 'auto';
  noColor?: boolean;
  label?: string;           // Device name shown below avatar
}): string[];

function renderSyncFrames(options: {
  model: IpodModelFamily;
  color: AvatarColor;
  progress: number;         // 0-1
  theme?: 'dark' | 'light' | 'auto';
}): string[];

function getAvailableColors(model?: IpodModelFamily): AvatarColor[];
function generationToModelFamily(generation: string): IpodModelFamily;
```

## Color Palette

| Color | Inspired By | Notes |
|---|---|---|
| Silver | Classic default | Light metallic |
| White | Classic | Needs border on light terminals |
| Black / Space Gray | Various | Needs border on dark terminals |
| Pink | Mini, Nano | |
| Blue | Mini, Nano | |
| Green | Mini, Nano | |
| Gold | Later models | |
| Red | (PRODUCT)RED | |
| Purple | Nano | |
| Orange | Nano | |
| Yellow | Nano | |

## Terminal Background & Contrast

**Detection strategy (ordered):**
1. OSC 11 escape sequence (`\e]11;?\a`) — works in iTerm2, Terminal.app, Ghostty, kitty, WezTerm
2. `COLORFGBG` environment variable
3. Heuristic from `TERM_PROGRAM`
4. Fallback: assume dark background

**Compensation:**
- Dark terminal + black iPod → subtle dim gray outline (ANSI 245)
- Light terminal + white iPod → medium gray outline
- Config override: `theme = "auto" | "dark" | "light"`

## Config Schema Changes

### Global avatar settings
```toml
[avatar]
enabled = true           # Master toggle
theme = "auto"           # "auto" | "dark" | "light"
```

### Per-device fields
```toml
[devices.terapod]
volumeUuid = "ABC-123"
volumeName = "TERAPOD"
avatarColor = "silver"   # Optional color choice
avatarModel = "classic"  # Optional model override (auto-detected if omitted)
```

### New TypeScript types
```typescript
interface AvatarConfig {
  enabled?: boolean;      // default true
  theme?: 'auto' | 'dark' | 'light';
}

// Added to DeviceConfig:
interface DeviceConfig {
  // ... existing
  avatarColor?: string;
  avatarModel?: string;
}
```

## CLI Integration

### New flags
- `--no-avatar` — suppress avatar display (global)
- `--avatar-theme dark|light` — override terminal theme detection

### Auto-suppression (avatar never shown when):
- `--json` flag is set
- `--quiet` flag is set
- stdout is not a TTY
- `NO_COLOR` is set (color stripped, but outline art could still show)
- Config `avatar.enabled = false`

### Interactive color picker (`device add`)

After detecting iPod model, present color picker using `@clack/prompts`:
1. Show detected model
2. Arrow-key color selector with color swatches
3. Preview full avatar with chosen color
4. Confirm or skip
5. Store in config

Non-TTY fallback: accept `--avatar-color <name>` flag, skip picker if absent.

### Integration points

| Command | Integration | Display |
|---|---|---|
| `device add` | After detection | Color picker → preview with excited face |
| `device info` | After status | Neutral avatar |
| `mount` | On success | Happy avatar |
| `eject` | On success | Sleepy avatar |
| `sync` progress | Above progress bar | Animated avatar with mini progress |
| `sync` complete | Replace animation | Satisfied avatar |
| `sync` error | Replace animation | Concerned avatar |
| `device list` | Not included initially | Stretch goal |

## Preview Script

A `bun run preview` script in `packages/ipod-avatar/scripts/preview.ts` for iterating on art:

**Single mode:**
```bash
bun run preview --model classic --expression happy --color silver
bun run preview --all-expressions --model nano-tall --color pink
bun run preview --all-models --expression neutral
```

**Gallery mode** (all models on a table):
```bash
bun run preview --gallery --expression neutral
bun run preview --gallery --expression happy --color red
```
- Detects terminal width, places iPods in rows with 2-3 char spacing
- Bottom-aligns iPods (shorter ones sit on same baseline as taller)
- Wraps to next row when iPods won't fit
- Shows model label beneath each

## Dependencies

- `@clack/prompts` — added to `podkit-cli` for interactive color picker
- No runtime dependencies for `@podkit/ipod-avatar` itself
