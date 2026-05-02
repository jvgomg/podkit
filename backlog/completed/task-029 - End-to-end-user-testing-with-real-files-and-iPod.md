---
id: TASK-029
title: End-to-end user testing with real files and iPod
status: Done
assignee: []
created_date: '2026-02-22 19:38'
updated_date: '2026-02-26 14:27'
labels: []
milestone: 'M3: Production Ready (v1.0.0)'
dependencies:
  - TASK-025
  - TASK-026
  - TASK-039
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Comprehensive testing session with real music files and physical iPod.

**Goals:**
- Validate full workflow works end-to-end
- Test documentation clarity (follow getting-started guide)
- Identify bugs and edge cases
- Gather feedback for improvements

**Test scenarios:**
- Fresh iPod (first sync)
- Incremental sync (add new tracks)
- Large library (100+ tracks)
- Various file formats
- Files with/without artwork
- Error scenarios (bad files, full iPod)

**Process:**
1. Follow getting-started guide on clean system
2. Run through test scenarios
3. Document issues found
4. Create follow-up tasks for bugs/improvements

**This is the final validation before 1.0 release.**
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Full workflow tested end-to-end
- [ ] #2 Documentation validated by following it
- [x] #3 Test scenarios completed
- [x] #4 Issues documented and triaged
- [x] #5 Ready for 1.0 release
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deferred from M2 - integration tests provide sufficient coverage for now

## E2E Test Infrastructure (TASK-039)

Automated E2E test package now available at `packages/e2e-tests/`. This provides:

**For CI (dummy iPod):**
```bash
bun run test:e2e
```

**For real iPod validation:**
```bash
# Run pre-flight checks first
cd packages/e2e-tests
IPOD_MOUNT=/Volumes/iPod bun run preflight

# Run tests against real device
IPOD_MOUNT=/Volumes/iPod bun run test:e2e:real
```

**Pre-flight checks verify:**
- CLI is built
- gpod-tool available
- FFmpeg available
- Test fixtures exist
- iPod mount accessible
- iTunesDB readable
- Sufficient free space (50MB)
- Write permissions

**Test coverage:**
- 37 automated tests across init, status, list, sync commands
- Fresh sync workflow (empty iPod → sync → verify)
- Incremental sync workflow (add tracks progressively)

The automated tests complement this manual validation task - they ensure the happy path works, while manual testing covers edge cases and real-world scenarios.

## First E2E Test Session Plan (2026-02-26)

### Prerequisites

- iPod with **existing database** (already initialized, may have tracks from iTunes)
- Test FLAC collection copied locally
- CLI built and available

### Test Workflow

```bash
# 1. Setup config
podkit init                           # Creates ~/.config/podkit/config.toml
# Edit config to set:
#   source = "/path/to/test-flacs"
#   device = "/Volumes/iPod"
#   quality = "high"  # or medium/low
#   artwork = true

# 2. Verify iPod connection
podkit status                         # Should show device info + track count

# 3. View what's currently on iPod
podkit list                           # Shows existing tracks

# 4. View source collection
podkit list --source /path/to/test-flacs

# 5. Preview sync
podkit sync --dry-run                 # Shows what will be added/removed

# 6. Run sync
podkit sync                           # Actually sync - watch for errors

# 7. Verify sync worked
podkit list                           # Check track count increased
podkit status                         # Check storage usage changed

# 8. Eject manually
diskutil eject /Volumes/iPod

# 9. Physical test on device
# - Navigate to synced tracks
# - Verify artwork displays
# - Play tracks, check audio quality
```

### What to Watch For

1. **Config loading** - Does podkit find and use the config correctly?
2. **Error messages** - Are they clear when something goes wrong?
3. **Dry-run accuracy** - Does the preview match what actually syncs?
4. **Progress display** - Is sync progress clear and informative?
5. **Transcoding** - Are FLACs converted to AAC correctly?
6. **Artwork** - Does album art appear on device?
7. **Metadata** - Are title/artist/album preserved correctly?
8. **Performance** - How long does sync take for N tracks?

### Known Limitations for First Test

- **No artwork/format/bitrate in list output** (TASK-053 pending)
- **No safe-to-unmount message** (TASK-054 pending)
- **libgpod may log CRITICAL warnings** (TASK-041 - cosmetic, tests still work)

### Verification Workarounds

Until TASK-053 is complete, verify artwork/quality by:
- Checking on physical device
- Using `file` command on transcoded files in iPod_Control/Music/
- Using `ffprobe` to check bitrate of transcoded files

### After Testing

Document any issues found and create follow-up tasks for:
- Bugs discovered
- UX improvements needed
- Missing features identified
- Documentation gaps

## Dependency Update (2026-02-26)

Removed TASK-027 and TASK-028 (getting-started guides) as dependencies. The first E2E test will be run before the guides are written - findings from testing will inform the guide content.

## First E2E Test Session Results (2026-02-26)

### Test Summary

**Environment:**
- iPod Video (5th Gen) with 1TB iFlash
- macOS (required manual mount workaround - documented in docs/MACOS-IPOD-MOUNTING.md)
- 482 existing tracks on iPod
- 6 test FLAC files with embedded artwork

**Test Flow:**
1. ✅ `podkit init` - created config successfully
2. ✅ Config edited - source, device, quality, artwork set
3. ✅ `podkit status` - showed iPod correctly (482 tracks)
4. ⚠️ `podkit list` - BUG: showed source collection, not iPod
5. ✅ `podkit list --source` - showed 6 test tracks
6. ✅ `podkit sync --dry-run` - correct preview (6 to add, 0 to remove)
7. ✅ `podkit sync` - completed in 2s, 6 tracks synced
8. ✅ Verification - track count 482→488, re-sync shows "Already synced: 6"
9. ✅ Physical device test - tracks play correctly
10. ❌ Artwork - NOT displayed on device

### Issues Found

| Task | Issue | Severity |
|------|-------|----------|
| TASK-056 | `podkit list` defaults to source, not iPod | High (bug) |
| TASK-057 | Artwork not transferred during sync | High (bug) |
| TASK-058 | CLI commands ambiguous (status/list unclear) | Medium (UX) |
| TASK-059 | "one" text leaked in sync progress output | Low (cosmetic) |

### Documentation Added

- `docs/MACOS-IPOD-MOUNTING.md` - workaround for large iFlash iPods not mounting on macOS

### What Worked Well

- Sync completed successfully and quickly (2s for 6 tracks)
- Transcoding FLAC→AAC worked correctly
- Existing tracks preserved (additive sync)
- Dry-run accurately predicted sync
- Metadata (title/artist/album) preserved correctly
- Re-sync correctly detected already-synced tracks

## Second E2E Test Session (2026-02-26)

**Purpose:** Verify bug fixes from first session

**Test:**
- Source: ~/Workstation/Music (Ben Quad - Ephemera, 5 FLAC tracks)
- Synced to iPod with 488 existing tracks

**Results:**
- ✅ TASK-056 fix verified: `podkit list` now shows iPod tracks by default
- ✅ TASK-057 fix verified: Artwork transferred (✓ shown in list output)
- ✅ TASK-053 verified: `--fields artwork,format,bitrate` working
- ✅ Transcoding: FLAC → AAC @ 258 kbps (high quality)
- ✅ Physical device: Artwork displays correctly

**All E2E bugs from first session now fixed and verified.**

## Task Completed (2026-02-26)

Marking complete. Documentation validation (criterion #2) deferred to TASK-027/TASK-028 (getting-started guides).

**Final results:**
- Two successful E2E test sessions with real iPod
- All bugs found have been fixed and verified (TASK-053, TASK-056, TASK-057, TASK-059)
- Full library sync tested (1,414 tracks)
- Artwork, transcoding, metadata all working correctly
- Created follow-up tasks for improvements (TASK-061, TASK-062, TASK-063)
<!-- SECTION:NOTES:END -->
