---
id: TASK-270
title: 'ipod-web: Firmware — playback engine and audio player'
status: Done
assignee: []
created_date: '2026-04-03 20:17'
updated_date: '2026-04-03 20:40'
labels:
  - ipod-web
  - firmware
  - audio
milestone: m-17
dependencies: []
references:
  - doc-028
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the playback state machine (Jotai atoms) and the audio player wrapper that drives actual audio output.

**Playback atoms:**
```typescript
currentTrackAtom     // Track | null
playbackStateAtom    // 'stopped' | 'playing' | 'paused'
positionAtom         // number (seconds)
durationAtom         // number (seconds)
volumeAtom           // 0-100
queueAtom            // Track[] — upcoming tracks
queueIndexAtom       // number — position in queue
shuffleAtom          // 'off' | 'songs' | 'albums'
repeatAtom           // 'off' | 'one' | 'all'
```

**Playback actions:**
- `playTrackAtom` — load track, build queue from context (album, playlist, all songs), start playback
- `playPauseAtom` — toggle play/pause
- `nextTrackAtom` — advance queue, respect repeat mode
- `previousTrackAtom` — restart current if >3s in, else go to previous
- `seekAtom` — set position
- `setVolumeAtom` — set volume

**Audio player (`audio/player.ts`):**
- Wraps an `<audio>` HTML element
- `play(url: string)` — load and play
- `pause()`, `resume()`, `seek(seconds)`, `setVolume(0-1)`
- Emits events: `timeupdate`, `ended`, `error`
- Gets audio URL from `StorageProvider.getAudioUrl(ipodPath)`
- Handles track transitions: on `ended`, trigger `nextTrackAtom`

**Queue building:**
- When user selects a track from an album view → queue = all album tracks, starting from selected
- When user selects from Songs → queue = all songs from selected index
- When user selects from playlist → queue = playlist tracks from selected
- Shuffle Songs → queue = all tracks, shuffled randomly
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tracks play via <audio> element using URLs from StorageProvider
- [x] #2 Play/pause/next/previous controls work
- [x] #3 Queue builds correctly from album, playlist, songs, and shuffle contexts
- [x] #4 Repeat modes work (off, one, all)
- [x] #5 Shuffle randomizes queue order
- [x] #6 Previous restarts track if >3s in, goes to previous otherwise
- [x] #7 Position updates in real-time for scrubber display
- [x] #8 Track auto-advances on end
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AudioPlayer wraps HTML audio element. Playback atoms: core state, queue management, all action atoms. playPause only toggles playing/paused. nextTrack handles repeat off/one/all. previousTrack restarts if >3s, else goes back. Volume clamped 0-100. Added ipodPath to Track interface. 18 new tests, 88 total passing.
<!-- SECTION:NOTES:END -->
