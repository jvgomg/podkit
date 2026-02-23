---
id: TASK-024
title: Research libgpod artwork handling
status: Done
assignee: []
created_date: '2026-02-22 19:38'
updated_date: '2026-02-23 01:31'
labels:
  - research
milestone: 'M3: Production Ready (v1.0.0)'
dependencies:
  - TASK-023
references:
  - docs/LIBGPOD.md
  - docs/IPOD-INTERNALS.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify that libgpod handles artwork resizing and format conversion automatically.

**Expected behavior (to verify):**
- libgpod detects iPod model and supported artwork formats
- itdb_track_set_thumbnails accepts source image and handles conversion
- Multiple required sizes generated automatically

**Research:**
- Review libgpod documentation for artwork functions
- Test with spike code from TASK-005
- Document any preprocessing we need to do (if any)

**Outcome:** Confirm we can pass source image to libgpod and it handles the rest, or document what preprocessing is required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 libgpod artwork handling verified
- [x] #2 Document what (if any) preprocessing needed
- [x] #3 Update TASK-025 with findings
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
# Research Findings: libgpod Artwork Handling

## Summary

**libgpod DOES handle artwork resizing and format conversion automatically.** When you call `itdb_track_set_thumbnails()` with any image file, libgpod will:

1. Detect the iPod model from SysInfo
2. Query the device's supported artwork formats (sizes, pixel formats)
3. Generate all required thumbnail sizes automatically
4. Convert to the correct pixel format (RGB565, JPEG, etc.)
5. Write to the appropriate `.ithmb` files

## Key Functions

### Setting Artwork (our primary interface)

```c
gboolean itdb_track_set_thumbnails(Itdb_Track *track, const gchar *filename);
```

- Accepts image file path (any format supported by gdk-pixbuf: JPEG, PNG, GIF, BMP, etc.)
- **Lazy generation**: Thumbnails generated when `itdb_write()` is called, not immediately
- Returns boolean success/failure

**Variants:**
- `itdb_track_set_thumbnails_from_data()` - accepts raw image bytes
- `itdb_track_set_thumbnails_from_pixbuf()` - accepts GdkPixbuf directly

### Querying Device Capabilities

```c
GList *itdb_device_get_cover_art_formats(const Itdb_Device *device);
gboolean itdb_device_supports_artwork(const Itdb_Device *device);
```

- Returns list of `Itdb_ArtworkFormat` structs with width, height, format
- Uses SysInfoExtended if available, falls back to hardcoded capability tables

### Itdb_ArtworkFormat Structure

```c
typedef struct {
    gint format_id;      // e.g., 1028, 1029
    gint width;          // e.g., 100, 200
    gint height;
    ItdbThumbFormat format;  // RGB565_LE, JPEG, etc.
    gboolean crop;
    gint rotation;
    // ... other fields
} Itdb_ArtworkFormat;
```

## Prerequisites for Artwork to Work

1. **SysInfo file must exist** - libgpod uses `iPod_Control/Device/SysInfo` to identify model
2. **Artwork directory must exist** - `iPod_Control/Artwork/` (created automatically by gpod-tool init)
3. **gdk-pixbuf must be available** - libgpod compiled with gdk-pixbuf support (standard on most systems)

## Recommended Approach for podkit

### What We Do

1. Extract embedded artwork from source audio files (TASK-023)
2. Save to temporary file (JPEG or PNG)
3. Call `itdb_track_set_thumbnails(track, temp_file_path)`
4. Let libgpod handle all resizing and format conversion
5. Call `itdb_write()` to persist

### What We DON'T Need To Do

- Query artwork formats ourselves
- Resize images
- Convert pixel formats
- Write to `.ithmb` files directly

## Implementation Notes

### Preferred: File-based approach

Based on Strawberry Music Player's experience, using `itdb_track_set_thumbnails(track, filename)` with a file path is more reliable than `itdb_track_set_thumbnails_from_data()` with raw bytes.

**Workflow:**
1. Extract artwork bytes from source file
2. Write to temporary file (e.g., `/tmp/artwork-{uuid}.jpg`)
3. Call `itdb_track_set_thumbnails(track, temp_path)`
4. Delete temp file after `itdb_write()` completes

### Binding Implementation

Add to `gpod_binding.cc`:

```cpp
Napi::Value SetTrackArtwork(const Napi::CallbackInfo& info) {
    // Get track ID and image path
    uint32_t trackId = info[0].As<Napi::Number>().Uint32Value();
    std::string imagePath = info[1].As<Napi::String>().Utf8Value();
    
    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    gboolean success = itdb_track_set_thumbnails(track, imagePath.c_str());
    
    return Napi::Boolean::New(env, success);
}
```

## Caveats and Known Issues

1. **iTunes compatibility**: iTunes stores artwork in the original file tags, not the iPod database. If iTunes accesses a track synced with libgpod, it may "lose" the artwork. This is expected behavior.

2. **Device detection**: Some iPod models may return `ITDB_IPOD_MODEL_INVALID` but still work. Artwork retrieval typically succeeds even when model detection fails.

3. **Lazy generation**: The actual thumbnail generation happens during `itdb_write()`, so image files must exist until write completes.

## Sources

- [libgpod Artwork API Documentation](https://fedorapeople.org/~tmz/docs/libgpod/libgpod-Tracks.html)
- [libgpod Device API Documentation](https://tmz.fedorapeople.org/docs/libgpod/libgpod-Device.html)
- [libgpod itdb_device.c source](https://github.com/neuschaefer/libgpod/blob/master/src/itdb_device.c)
- [Strawberry Music Player Issue #519](https://github.com/strawberrymusicplayer/strawberry/issues/519)
<!-- SECTION:NOTES:END -->
