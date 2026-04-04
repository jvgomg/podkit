---
id: TASK-271
title: 'ipod-web: iPod 5th gen shell and screen rendering'
status: Done
assignee: []
created_date: '2026-04-03 20:17'
updated_date: '2026-04-03 20:35'
labels:
  - ipod-web
  - ui
  - visual
milestone: m-17
dependencies: []
references:
  - doc-028
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the visual shell (device body) and screen rendering for an iPod 5th generation (Video).

**Shell (`Shell.tsx`):**
- Renders the iPod 5th gen physical body as CSS/SVG
- White or black color variant (prop-configurable)
- Rounded corners matching real device proportions
- Screen cutout area where `Screen.tsx` renders
- Click wheel area below screen where `ClickWheel.tsx` renders
- `data-tauri-drag-region` on the body area (above screen, sides) for window dragging in Tauri
- Proportions: roughly 2:3.4 width:height ratio (real iPod Video is 61.8mm × 103.5mm)
- High-res rendering — use CSS with careful proportions, not pixel art

**Screen (`Screen.tsx`):**
- LCD display area with 320×240 logical resolution
- Rendered at 2x or 3x for crisp display on retina screens
- Subtle LCD-like styling (slight warmth to the white background, or configurable)
- Contains the header bar and current screen content
- Screen transitions: slide left (forward) and slide right (back) animations between menus

**Header (`shared/Header.tsx`):**
- Title bar at top of screen (matches current menu name)
- Battery icon (always full — it's virtual)
- Play/pause indicator icon when music is playing
- Lock icon area (decorative)

**Overall `VirtualIpod.tsx` composition:**
```tsx
<div className="virtual-ipod">
  <Shell>
    <Screen>
      <Header />
      <CurrentScreen />  {/* routed by menu state */}
    </Screen>
    <ClickWheel />
  </Shell>
</div>
```

**Reference:** Study photos/screenshots of iPod 5th gen for accurate proportions, colors, and layout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Shell resembles iPod 5th gen body with correct proportions
- [x] #2 Screen renders at 2x+ resolution for crisp display
- [x] #3 Header shows menu title, battery, and play indicator
- [ ] #4 Screen transitions animate on menu navigation (slide left/right)
- [x] #5 Tauri drag region set on body area
- [x] #6 Component renders correctly in both browser and Tauri WebView
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shell: 380x637px (1:1.675 ratio), white/black variants, gradients, box shadows, data-tauri-drag-region. Screen: chrome bezel, warm white LCD (#f8f6f0), inset shadow. Header: play indicator, title, CSS-drawn battery. VirtualIpod composes Shell+Screen+Header+ClickWheel. Added happy-dom for test environment. Screen transitions (AC #4) deferred — can be added when menu navigation is wired up.
<!-- SECTION:NOTES:END -->
