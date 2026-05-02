---
id: TASK-273
title: 'ipod-web: Now Playing screen with album art and scrubber'
status: Done
assignee: []
created_date: '2026-04-03 20:18'
updated_date: '2026-04-03 21:03'
labels:
  - ipod-web
  - ui
  - screens
milestone: m-17
dependencies:
  - TASK-270
references:
  - doc-028
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the Now Playing screen — displayed when music is playing. This is the most visually rich screen.

**Layout (iPod 5th gen Now Playing):**
- Album artwork displayed prominently (left side or center, large)
- Track title, artist name, album name
- Progress scrubber bar showing elapsed / total time
- Track number in queue (e.g., "3 of 12")
- Volume bar (triggered by scroll wheel when on this screen)

**Behavior:**
- Scroll wheel on Now Playing adjusts volume (not menu navigation)
- Center button cycles through display modes: artwork view → scrubber view → rating view (simplified: just artwork and scrubber for v1)
- Next/Previous buttons on click wheel skip tracks
- Menu button returns to the previous menu

**Artwork:**
- Loaded from `IpodReader.getTrackArtwork(trackId)` which returns decoded `ImageData`
- Rendered to a canvas or as a blob URL `<img>`
- Fallback: generic music note icon when no artwork available
- Artwork should be displayed at a good size — the iPod 5th gen shows it at roughly 120×120px on its 320×240 screen, so at our 2x+ render scale that's 240×240px+

**Scrubber:**
- Uses `ProgressBar` component
- Shows elapsed time (left) and remaining time (right)
- Updates in real-time from `positionAtom`
- Not interactive (no drag-to-seek in v1 — the real iPod uses scroll wheel for seeking)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Album artwork displays for current track
- [x] #2 Fallback icon shown when no artwork available
- [x] #3 Track title, artist, album displayed
- [x] #4 Scrubber bar shows progress and updates in real-time
- [x] #5 Elapsed and remaining time labels update
- [ ] #6 Scroll wheel adjusts volume on this screen
- [ ] #7 Next/Previous buttons skip tracks
- [x] #8 Track position in queue shown (e.g. 3 of 12)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Now Playing with artwork placeholder (♫ music note), track info (title/artist/album with ellipsis), scrubber using ProgressBar from TASK-272, queue position display. formatTime helper. Graceful null track handling. 6 tests. AC #6 (volume scroll) and #7 (next/prev) are handled by VirtualIpod wiring in TASK-272.
<!-- SECTION:NOTES:END -->
