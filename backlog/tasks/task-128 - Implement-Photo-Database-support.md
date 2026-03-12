---
id: TASK-128
title: Implement Photo Database support
status: To Do
assignee: []
created_date: '2026-03-12 10:57'
labels:
  - phase-10
  - photos
milestone: ipod-db Photo Database
dependencies:
  - TASK-119
  - TASK-121
references:
  - doc-003
documentation:
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_photoalbum.c
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add full photo database support to @podkit/ipod-db by implementing the PhotoDatabase class with ~15 methods for photo and album management.

**Photo Database location:** `iPod_Control/Photos/Photo Database` (or `Photos/Photo Database`)

**Format:** Similar tagged binary structure to iTunesDB/ArtworkDB but focused on photos:
- Same MHFD/MHSD/MHLI/MHII/MHOD record hierarchy
- Photo-specific MHSD sections
- Photo thumbnails stored in `Photos/Thumbs/F{format_id}_{index}.ithmb`

**PhotoDatabase class (~15 methods):**

*Photo management:*
- `getPhotos()` — List all photos
- `addPhoto(imagePath)` — Add photo, generate thumbnails in device-specific formats
- `removePhoto(photoId)` — Remove photo and thumbnails
- `getPhotoThumbnail(photoId, format?)` — Get thumbnail data

*Album management:*
- `getAlbums()` — List all photo albums
- `createAlbum(name)` — Create photo album
- `removeAlbum(albumId)` — Delete album
- `renameAlbum(albumId, newName)` — Rename album
- `getAlbumPhotos(albumId)` — Get photos in album
- `addPhotoToAlbum(albumId, photoId)` — Add photo to album
- `removePhotoFromAlbum(albumId, photoId)` — Remove from album

*Lifecycle:*
- `open(mountpoint)` — Parse Photo Database
- `save()` — Write Photo Database
- `close()` — Release resources

*Device integration:*
- Use device photo format table (`getPhotoFormats(generation)`) for thumbnail generation
- Photo-specific pixel formats and dimensions

**Thumbnail generation:**
- Use `sharp` for image loading, resizing, EXIF rotation
- Generate thumbnails in all device-supported photo formats
- Write to `Photos/Thumbs/` .ithmb files (same format as artwork .ithmb)

**Reuse:** The ArtworkDB parser/writer infrastructure (TASK-119) can be heavily reused since the Photo Database uses the same binary record types. The .ithmb generation code is identical.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Photo Database binary format parsed correctly
- [ ] #2 PhotoDatabase class implements all ~15 methods
- [ ] #3 Photos added with correct thumbnails in all device-supported formats
- [ ] #4 Photo albums support CRUD operations
- [ ] #5 Photo thumbnails written to Photos/Thumbs/ directory
- [ ] #6 Existing photos.integration.test.ts passes with full assertions
- [ ] #7 Photo format table covers all devices with photo support
- [ ] #8 Round-trip test: parse Photo Database → write → parse → compare
- [ ] #9 Integration tests cover photo + album lifecycle
<!-- AC:END -->
