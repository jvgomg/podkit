---
id: DRAFT-022
title: macOS Music.app auto-sync wipes podkit-synced iPods
status: Draft
assignee: []
created_date: '2026-08-13 21:19'
labels:
  - macos
  - docs
  - diagnostics
milestone: m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Observed

On 2026-08-13 a shuffle 2g was synced with podkit (198 tracks, 870 MB, verified on disk), unplugged, then replugged. All 198 files were gone and the device carried Apple's empty database.

Forensics (not podkit):

```
21:33:18  iPod removed
21:36:51  iPod enumerated 0x05ac/1301
21:37:17  AMPDevicesAgent — write to prefs domain com.apple.iPod
21:37:32  198 files deleted; iTunesDB replaced (3532 B)
21:37:34  iTunesSD (18 B) + iTunesPrefs.plist written
```

`F00/F01/F02` survived as empty directories stamped 21:37:32 — files deleted individually, not lost buffers. `iTunesPrefs.plist` carries `DevicesVersion 1.5.6` with empty `MusicTrackIDs`/`MusicPlaylistIDs`: Apple's "sync this device to nothing".

Neither `com.apple.Music dontAutomaticallySyncIPods` nor the iTunes-domain equivalent was set.

## Why podkit should care

Not podkit's bug, but it will hit every macOS user who syncs an iPod with podkit while Music.app auto-sync is enabled, and it presents as *podkit losing data*. It also masked a genuine podkit bug for an hour (TASK-479.01) by making an unplayable device look like a wiped one.

## Candidate responses

1. **Docs** — troubleshooting entry: symptom, the `defaults write com.apple.Music dontAutomaticallySyncIPods -bool true` fix, and the Music -> Settings -> Devices equivalent. Low cost, clearly worth doing.
2. **Doctor detection** — recognise Apple's signature (empty `MusicTrackIDs` in `iTunesPrefs.plist` + `DevicesVersion` + an 18-byte `iTunesSD`) and report "this device was last written by Apple Music, not podkit". Turns a mystery into a diagnosis. Also useful during shuffle development to spot Music.app interference between test runs.
3. **First-run warning on macOS** when the pref is unset — rejected as too naggy for a once-per-machine setup step.

Filed as Draft: build (1) and (2) only if they fall out cheaply alongside the shuffle work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Troubleshooting docs explain the symptom and the fix
- [ ] #2 Doctor can attribute an Apple-written database when the signature is present
- [ ] #3 No first-run nagging is added
<!-- AC:END -->
