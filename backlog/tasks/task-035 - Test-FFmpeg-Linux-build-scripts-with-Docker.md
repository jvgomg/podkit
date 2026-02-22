---
id: TASK-035
title: Test FFmpeg Linux build scripts with Docker
status: To Do
assignee: []
created_date: '2026-02-22 22:19'
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
- [ ] #1 Build scripts work on Debian 12 in Docker
- [ ] #2 Built FFmpeg includes libfdk_aac encoder
- [ ] #3 Transcoding test produces valid AAC output
- [ ] #4 Dockerfile and test script added to repo
- [ ] #5 README updated with Docker test instructions
<!-- AC:END -->
