---
"podkit": minor
"@podkit/core": minor
"@podkit/libgpod-node": minor
---

Sync composer, grouping, track/disc totals and sort fields to iPods

The directory adapter now reads composer, grouping, total tracks, total discs and the sort fields (sort title, artist, album, album artist, composer) from file tags. They are written to the iPod database when a track is added, and a change to any of them at the source is detected as a metadata correction and updated in place without copying the file again. A tag removed at the source is cleared on the device. A field the source cannot report is left untouched rather than cleared; Subsonic sources do not report these fields yet.

Mass-storage change detection is unchanged: podkit does not compare these fields there. A multi-disc track added to a mass-storage device now gets the `Album (disc N)` folder its path template asks for, since the total disc count reaches it. The comment field still carries podkit's sync tag; file comments are not copied.

`@podkit/libgpod-node` adds `sortTitle`, `sortArtist`, `sortAlbum`, `sortAlbumArtist` and `sortComposer` to `Track`, `TrackInput` and `updateTrack`.

**One-time effect:** the first sync after upgrading updates the iPod database entry of every track whose files carry these tags, and clears these fields on the iPod for tracks whose files lack them, since a folder collection is authoritative for its tags. No audio is copied or re-encoded for it.
