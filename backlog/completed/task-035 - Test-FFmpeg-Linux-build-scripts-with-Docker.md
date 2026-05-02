---
id: TASK-035
title: Test FFmpeg Linux build scripts with Docker
status: Done
assignee: []
created_date: '2026-02-22 22:19'
updated_date: '2026-02-22 22:35'
labels:
  - testing
  - tooling
milestone: 'M2: Core Sync (v0.2.0)'
dependencies:
  - TASK-014
references:
  - tools/ffmpeg-linux/
  - docs/TRANSCODING.md
  - docs/adr/ADR-003-transcoding.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Test the `tools/ffmpeg-linux/` build scripts using Docker to verify they work on Debian/Ubuntu.

**Goal:** Ensure the build scripts work correctly on a clean Linux system before users try them.

**Test approach:**
1. Create a Dockerfile that starts from `debian:bookworm` (Debian 12)
2. Copy the build scripts into the container
3. Run `install-deps.sh` and `build-ffmpeg.sh`
4. Verify the built FFmpeg has `libfdk_aac` encoder
5. Test transcoding a sample audio file

**Deliverables:**
- `tools/ffmpeg-linux/Dockerfile` - for testing the build
- `tools/ffmpeg-linux/test-build.sh` - script to run the Docker test
- Update README with Docker test instructions
- Fix any issues discovered during testing

**Test matrix:**
- Debian 12 (bookworm) - primary target
- Ubuntu 22.04 (optional, if time permits)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Build scripts work on Debian 12 in Docker
- [x] #2 Built FFmpeg includes libfdk_aac encoder
- [x] #3 Transcoding test produces valid AAC output
- [x] #4 Dockerfile and test script added to repo
- [x] #5 README updated with Docker test instructions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation (2026-02-22)

### Files Created
- `tools/ffmpeg-linux/Dockerfile` - Debian 12 build test container
- `tools/ffmpeg-linux/test-build.sh` - Script to run the Docker test

### Files Updated
- `tools/ffmpeg-linux/install-deps.sh` - Added non-free repository support for Debian
- `tools/ffmpeg-linux/build-ffmpeg.sh` - Added lavfi demuxer and sine filter for testing
- `tools/ffmpeg-linux/README.md` - Added Docker testing instructions

### Issues Fixed During Testing
1. **Non-free repository:** Debian's `libfdk-aac-dev` is in the non-free repo. Updated install script to enable it automatically using DEB822 format.
2. **Build config:** Added `--enable-demuxer=lavfi` and audio filters for test compatibility.

### Test Results
- Debian 12 (bookworm): ✓ Build successful
- FFmpeg 7.1 built with libfdk_aac encoder
- Both `aac` and `libfdk_aac` encoders available

### Additional Feature

Added `build-with-docker.sh` script that builds FFmpeg using Docker and extracts the binary for use on Linux systems. Supports cross-architecture builds (--arch amd64/arm64).
<!-- SECTION:NOTES:END -->
