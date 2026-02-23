---
id: TASK-025
title: Implement artwork transfer to iPod
status: To Do
assignee: []
created_date: '2026-02-22 19:38'
updated_date: '2026-02-23 01:31'
labels: []
milestone: 'M3: Production Ready (v1.0.0)'
dependencies:
  - TASK-024
  - TASK-021
references:
  - docs/LIBGPOD.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Transfer artwork to iPod via libgpod.

**Implementation:**
- Extract embedded artwork (from TASK-023)
- Pass to libgpod (itdb_track_set_thumbnails or equivalent)
- libgpod should handle resizing/format conversion based on device capabilities

**Note:** TASK-024 will confirm libgpod handles resize/format. Adjust implementation if preprocessing needed.

**Testing requirements:**
- Integration test with test iPod environment
- Verify artwork appears correctly on device
- Test tracks with and without artwork in same sync
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Artwork extracted and passed to libgpod
- [ ] #2 libgpod handles device-specific formatting
- [ ] #3 Integration test verifies artwork works
- [ ] #4 Handles tracks without artwork gracefully
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Findings from TASK-024

**libgpod handles all artwork resizing and format conversion automatically.**

### Implementation Approach

1. **Extract artwork** from source audio files using music-metadata (TASK-023)
2. **Write to temp file** (JPEG or PNG) - file-based approach is more reliable than raw bytes
3. **Call `itdb_track_set_thumbnails(track, temp_path)`** - libgpod does the rest
4. **Delete temp file** after `itdb_write()` completes

### What libgpod Does Automatically

- Detects iPod model from SysInfo
- Queries supported artwork formats (sizes, pixel formats)
- Generates all required thumbnail sizes
- Converts to correct pixel format (RGB565, JPEG, etc.)
- Writes to `.ithmb` files

### Binding Function Needed

```cpp
Napi::Value SetTrackArtwork(const Napi::CallbackInfo& info) {
    uint32_t trackId = info[0].As<Napi::Number>().Uint32Value();
    std::string imagePath = info[1].As<Napi::String>().Utf8Value();
    
    Itdb_Track* track = itdb_track_by_id(db_, trackId);
    gboolean success = itdb_track_set_thumbnails(track, imagePath.c_str());
    
    return Napi::Boolean::New(env, success);
}
```

### Prerequisites

- SysInfo file must exist (gpod-tool init handles this)
- Artwork directory must exist (gpod-tool init handles this)
- libgpod compiled with gdk-pixbuf support (standard)

### Caveats

- Thumbnails generated lazily during `itdb_write()` - temp files must exist until then
- iTunes may "lose" artwork if it accesses tracks (expected behavior)
<!-- SECTION:NOTES:END -->
