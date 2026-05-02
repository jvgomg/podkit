---
id: TASK-272
title: 'ipod-web: Menu and library screen components'
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
  - TASK-269
references:
  - doc-028
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the screen components that render menu lists and library content. These are the views the user sees when navigating the iPod.

**Shared components:**

`ListView.tsx` — The core reusable list component used by almost every screen:
- Renders a scrollable list of items with a blue highlight bar on the selected item
- Shows N visible items (iPod shows ~7-8 items on its 320×240 screen at this font size)
- Scroll offset tracks which items are visible
- Selected item stays visible (auto-scroll when selection moves past visible window)
- Each item shows: label text, optional right-aligned detail text, optional chevron (›) for submenus
- iPod-style appearance: alternating subtle background on rows, blue selection highlight with white text

`ProgressBar.tsx` — Reusable bar for scrubber and volume:
- Filled/unfilled segments
- Diamond or circle position indicator
- Optional time labels (elapsed / remaining)

**Screen components (all use ListView internally):**

- `MainMenu.tsx` — Music, Shuffle Songs, Settings, Now Playing (conditional)
- `MusicMenu.tsx` — Playlists, Artists, Albums, Songs, Genres, Now Playing
- `Artists.tsx` — Alphabetical artist list from database
- `Albums.tsx` — Album list (album name + artist as detail text)
- `Songs.tsx` — All tracks alphabetical (title + artist as detail)
- `Genres.tsx` — Genre list from database
- `Playlists.tsx` — Playlist names from database
- `PlaylistDetail.tsx` — Tracks in a specific playlist
- `Settings.tsx` — Shuffle, Repeat, About

Each screen reads from Jotai atoms and renders via ListView. No direct database access — everything through the store layer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ListView renders scrollable list with blue selection highlight
- [x] #2 All menu screens render correct items from database
- [x] #3 Submenus show chevron indicator
- [x] #4 Auto-scroll keeps selected item visible
- [x] #5 Artist → Albums → Tracks drill-down works
- [x] #6 Settings screen shows current values and cycles on select
- [x] #7 Screens match iPod 5th gen visual style (colors, spacing, layout)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ListView with iPod blue gradient selection, chevrons, detail text, auto-scroll windowing. ProgressBar with diamond indicator. MenuScreen connects atoms to ListView. ScreenRouter routes menu↔NowPlaying. VirtualIpod fully wired: Jotai Provider, ClickWheel→atoms, Header→currentTitle+playbackState, menu init via createMainMenu on mount, scroll→adjustVolume on Now Playing. 12 new tests (8 ListView + 4 VirtualIpod). Note: 1 pre-existing NowPlaying test error from missing @testing-library/dom dep — needs cleanup.
<!-- SECTION:NOTES:END -->
