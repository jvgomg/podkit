---
id: TASK-268
title: 'ipod-web: Click wheel component with rotational tracking and keyboard input'
status: Done
assignee: []
created_date: '2026-04-03 20:16'
updated_date: '2026-04-03 20:35'
labels:
  - ipod-web
  - ui
  - interaction
milestone: m-17
dependencies: []
references:
  - doc-028
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the click wheel — the primary input device for the virtual iPod. This is the most interaction-heavy component.

**Three simultaneous input modes:**

### 1. Mouse/touch rotational drag
- Circular element; user clicks and drags around the circumference
- Convert mouse position to angle relative to wheel center: `Math.atan2(dy, dx)`
- Track angular delta between `pointermove` events
- Dead zone: ignore movement within inner ~40% radius (that's the center button area)
- Accumulate angular delta; emit `onScroll(direction)` per N degrees of rotation (tune for feel — ~15-20° per tick)
- Direction: clockwise = scroll down (+1), counter-clockwise = scroll up (-1)
- Handle the ±π wrap-around when crossing the 180° boundary
- Use `pointerdown`/`pointermove`/`pointerup` for unified mouse+touch handling
- Set `touch-action: none` to prevent browser scroll interference

### 2. Keyboard input
| Key | Action atom |
|-----|-------------|
| Arrow Up | `scrollUpAtom` |
| Arrow Down | `scrollDownAtom` |
| Arrow Right / Enter | `selectAtom` (forward/select) |
| Arrow Left / Escape | `menuBackAtom` (back) |
| Space | `playPauseAtom` |

- Key repeat should work naturally for arrow up/down (hold to scroll fast)
- Only capture keys when the iPod component has focus

### 3. Button zones (5 hit areas)
- **Center circle:** Select/confirm (same as Enter)
- **Top arc:** Menu/back (same as Escape)
- **Bottom arc:** Play/pause (same as Space)
- **Left arc:** Previous/rewind
- **Right arc:** Next/fast-forward

Hit testing: determine which zone a click lands in based on angle and distance from center. Center = distance < inner radius. Cardinal zones = pie slices of the outer ring (±45° around each cardinal direction).

### Visual design
- Render as SVG or CSS with the 5th gen click wheel appearance
- White/silver outer ring, dark gray center button
- Visual feedback on button press (subtle highlight)
- The wheel should feel tactile — consider a subtle CSS transition or haptic-style visual pulse on each scroll tick

### Component API
```tsx
interface ClickWheelProps {
  onScroll: (direction: 1 | -1) => void
  onSelect: () => void
  onMenu: () => void
  onPlayPause: () => void
  onPrevious: () => void
  onNext: () => void
}
```

Or better: connect directly to Jotai atoms so the wheel drives navigation state without prop drilling.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Rotational drag scrolls through menu items — clockwise = down, CCW = up
- [x] #2 Dead zone in center prevents scroll when clicking center button
- [x] #3 Angular wrap-around at ±180° handled correctly (no jumps)
- [x] #4 Keyboard arrows scroll up/down, Enter selects, Escape goes back, Space plays/pauses
- [x] #5 Key repeat works for held arrow keys
- [x] #6 Five button zones respond to click with correct action
- [x] #7 Visual feedback on button press
- [x] #8 Works on both mouse and touch (pointer events)
- [x] #9 Scroll speed proportional to rotation speed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full click wheel with three input modes. Rotational drag: pointer events, ~18° threshold, ±π wrap-around, setPointerCapture, dead zone at 40% radius. Keyboard: auto-focus on mount, all 7 key mappings. Button zones: center/top/right/bottom/left with 150ms visual feedback. Click vs drag distinguished by hasDragged flag. 12 tests passing. Note: agent mentioned 2 pre-existing failures in firmware/menu.test.ts — likely from TASK-269 agent's in-progress work.
<!-- SECTION:NOTES:END -->
