---
id: TASK-231
title: Documentation for mass-storage device support and Echo Mini
status: Done
assignee: []
created_date: '2026-03-23 20:35'
updated_date: '2026-03-28 14:04'
labels:
  - docs
milestone: 'Additional Device Support: Echo Mini'
dependencies:
  - TASK-226
documentation:
  - backlog/docs/doc-020 - Architecture--Multi-Device-Support-Decisions.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update user-facing documentation to cover non-iPod device support. Users should understand what's supported, how to set up their device, and what caveats exist.

**Documentation needed:**

**Device setup guide:**
- How to set up an Echo Mini (or other mass-storage DAP) with podkit
- The `podkit device setup` wizard walkthrough
- Manual config for devices that can't be auto-detected
- Capability overrides for power users / unsupported devices

**Supported devices page:**
- Clear list of supported device types (iPod, Echo Mini, generic mass-storage)
- Per-device: supported audio formats, artwork handling, playlist support, known limitations
- Link to device profiles in `devices/` for technical details

**Caveats and limitations (compared to iPod support):**
- No database — device must rescan tags on each connect (may be slow for large libraries)
- Folder structure determines navigation on device — podkit controls this
- Sidecar artwork behavior differences from iPod's database artwork
- No SoundCheck / ReplayGain normalization (unless the device reads RG tags)
- Playlist format differences (`.m3u` vs iTunesDB)
- No smart playlists on mass-storage devices
- Pre-existing music on device: how podkit handles files it didn't put there
- Device detection may require initial setup vs iPod's plug-and-play

**Update existing docs:**
- Getting started guide — mention non-iPod support
- Config reference — document `[[devices]]` section with type and capability fields
- FAQ — common questions about non-iPod devices
- Shell completions docs — new commands
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Device setup guide written for Echo Mini / mass-storage DAPs
- [x] #2 Supported devices page lists device types with formats, artwork, and limitations
- [x] #3 Caveats clearly documented (no database, folder structure, sidecar artwork, no smart playlists)
- [x] #4 Config reference updated with [[devices]] schema and capability overrides
- [x] #5 Getting started guide updated to mention non-iPod support
- [ ] #6 Shell completions updated for new commands
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Research findings relevant to docs (DOC-022)

**Key user-facing caveats to document:**
- Library shows filenames, not title tags — podkit handles this automatically
- Progressive JPEG artwork won't display — podkit converts to baseline
- No sidecar artwork support
- Dual volumes mount (internal + SD) — explain in setup guide
- Opus files invisible to device — podkit transcodes automatically
- Multi-disc albums display interleaved — podkit works around this
- No gapless playback (hardware limitation)
- No playlists

**USB detection details for setup guide:**
VID 0x071b, PID 0x3203, manufacturer "ECHO MINI"
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Documentation for mass-storage device support

Comprehensive documentation update to integrate mass-storage DAP support across the docs site. The docs now frame podkit as a tool for portable music players broadly — iPods and mass-storage DAPs alike — while calling out device-specific differences where they matter.

### Changes

**Major rewrites:**
- **Supported Devices page** — restructured from iPod-only to a two-category device hub with mass-storage profiles table (Echo Mini, Rockbox, generic), custom device configuration guide, and "request your device" callout
- **Landing page** — hero, features, supported devices section, and quick start all reframed for multi-device
- **Rockbox page** — now presents Rockbox as a first-class device type with native folder-based sync
- **Quick Start** — device-agnostic flow with tip callout for `--type` usage
- **Adding a Device** — new mass-storage DAP section with `--type` flag and capability overrides
- **Managing Devices** — examples include mass-storage device alongside iPods

**Config reference:**
- Added `type`, `supportedAudioCodecs`, `artworkSources`, `artworkMaxResolution`, `supportsVideo`, `audioNormalization`, `musicDir` capability overrides

**Feature-specific accuracy (verified via code review):**
- **Artwork**: table shows source type + max resolution per device; `artworkSources` documented as ordered priority list
- **Audio normalization**: documented as device-aware capability (`soundcheck`/`replaygain`/`none`) with per-mode behavior
- **Video**: note callout on video page that mass-storage devices don't support video (`supportsVideo: false`)
- **Clean artists**: confirmed device-agnostic, page updated accordingly
- **Mount/eject**: works for all device types, iPod-specific language removed

**Other updates:**
- Deleted `other-devices.md`, added redirect to supported-devices
- Roadmap: moved mass-storage support to Shipped
- Device-agnostic language across ~15 pages (syncing, transcoding, collections, etc.)

### Not included
- GitHub discussion updates (not ready to release)
- Shell completions docs (AC #6 — separate task, depends on new commands being finalized)
<!-- SECTION:FINAL_SUMMARY:END -->
