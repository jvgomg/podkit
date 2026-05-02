---
id: TASK-269
title: 'ipod-web: Firmware — menu state machine and navigation atoms'
status: Done
assignee: []
created_date: '2026-04-03 20:17'
updated_date: '2026-04-03 20:37'
labels:
  - ipod-web
  - firmware
milestone: m-17
dependencies: []
references:
  - doc-028
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the iPod's menu system as a Jotai-based state machine. This is the "brain" of the iPod — pure logic, no DOM.

**Menu tree (iPod 5th gen, music-only):**
```
Main Menu
├── Music
│   ├── Playlists → [list from database]
│   │   └── {playlist name} → [track list]
│   ├── Artists → [list from database]
│   │   └── {artist} → [albums by artist]
│   │       └── {album} → [tracks]
│   ├── Albums → [list from database]
│   │   └── {album} → [tracks]
│   ├── Songs → [all tracks, alphabetical]
│   ├── Genres → [list from database]
│   │   └── {genre} → [tracks]
│   └── Now Playing → [current track screen]
├── Shuffle Songs (action: shuffle all, start playback)
├── Settings
│   ├── Shuffle → Off / Songs / Albums
│   ├── Repeat → Off / One / All
│   └── About → Device info from IpodReader
└── Now Playing → [only visible when a track is loaded]
```

**Jotai atoms:**

```typescript
// Navigation state
menuStackAtom        // MenuNode[] — breadcrumb trail
selectedIndexAtom    // number — which item is highlighted
scrollOffsetAtom     // number — for lists longer than screen height

// Derived
currentMenuAtom      // computed from stack top
currentItemsAtom     // computed: static items or dynamic from database
visibleItemsAtom     // computed: windowed slice for rendering

// Actions (write-only atoms)
scrollAtom           // (direction: 1|-1) => move selection
selectAtom           // enter submenu or trigger action
menuBackAtom         // pop menu stack
```

**Menu node types:**
- `StaticMenu` — fixed children (Main Menu, Music, Settings)
- `DynamicMenu` — children computed from database (Artists, Albums, etc.)
- `ActionItem` — triggers a function (Shuffle Songs, play a track)
- `SettingItem` — cycles through options (Shuffle, Repeat)
- `ScreenItem` — navigates to a special screen (Now Playing)

**Navigation behavior:**
- Select on a submenu → push to stack, reset selectedIndex to 0
- Select on a track → start playback, navigate to Now Playing
- Menu/back → pop stack (stop at Main Menu)
- Scroll wraps around at list boundaries (top→bottom, bottom→top)

**Database integration:**
- Menu items for Artists/Albums/Songs/Playlists/Genres come from `IpodReader` queries
- These atoms depend on `databaseAtom` (the loaded IpodReader instance)
- When database reloads (after sync), menus update automatically via Jotai reactivity
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Menu tree matches iPod 5th gen structure (music-only)
- [x] #2 Navigation push/pop works correctly through all menu levels
- [x] #3 Dynamic menus populated from IpodReader (artists, albums, songs, playlists, genres)
- [ ] #4 Selecting a track starts playback and navigates to Now Playing
- [x] #5 Shuffle Songs action shuffles all tracks and begins playback
- [x] #6 Settings cycle through options (shuffle off/songs/albums, repeat off/one/all)
- [x] #7 Scroll wraps around at list boundaries
- [x] #8 Menu state is testable without rendering (pure Jotai atoms)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full menu tree: Music (Playlists, Artists→Albums→Tracks, Albums→Tracks, Songs, Genres→Tracks, Now Playing), Shuffle Songs, Settings (Shuffle/Repeat cycle, About). Dynamic menus lazy-load from database. Null database handled gracefully. menuVersionAtom added to force Jotai recomputation when settings change (settings read via store getter, not Jotai derivation). 42 tests (20 navigation + 22 menu). AC #4 (selecting track starts playback) deferred — needs TASK-270 playback atoms.
<!-- SECTION:NOTES:END -->
