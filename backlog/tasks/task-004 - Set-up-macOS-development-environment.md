---
id: TASK-004
title: Set up macOS development environment
status: Done
assignee: []
created_date: '2026-02-22 18:32'
updated_date: '2026-02-22 20:37'
labels: []
milestone: 'M0: Project Bootstrap'
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Get the development environment working on macOS:

**System dependencies:**
- Install libgpod via Homebrew
- Install FFmpeg via Homebrew
- Verify GLib is available

**Verification:**
- Can import/link libgpod headers
- FFmpeg CLI works
- Document any macOS-specific setup steps

**Outcome:** Update AGENTS.md or create docs/DEVELOPMENT.md with macOS setup instructions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 libgpod installed and headers accessible
- [x] #2 FFmpeg installed and working
- [x] #3 Setup steps documented
- [x] #4 Agent can run basic development commands
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Created `tools/libgpod-macos/` with build scripts for libgpod on macOS.

### Key Decisions
- **Local prefix**: Installs to `~/.local` by default (no sudo required)
- **Homebrew dependencies**: Uses Homebrew for all build deps (libplist, gdk-pixbuf, etc.)
- **Patches**: Two patches required for modern systems:
  - MacPorts callout patch (fixes macOS compilation)
  - PLD Linux libplist patch (libplist 2.x API compatibility)

### Files Created
- `tools/libgpod-macos/build.sh` - Full build script with deps/download/build/install steps
- `tools/libgpod-macos/README.md` - Documentation
- `tools/libgpod-macos/.gitignore` - Ignores build artifacts

### Verification
- libgpod 0.8.3 builds and installs successfully
- FFmpeg AAC encoding works (native aac and aac_at via AudioToolbox)
- arm64 Mach-O dylib produced

### Environment Setup Required
Users need to add to shell profile:
```bash
export PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig:$PKG_CONFIG_PATH"
export DYLD_LIBRARY_PATH="$HOME/.local/lib:$DYLD_LIBRARY_PATH"
```

### Additional Documentation
- `docs/DEVELOPMENT.md` - Full setup guide for macOS, Linux, Windows (TBD)
- Updated `docs/README.md` - Added DEVELOPMENT.md to Core Documents
- Updated `AGENTS.md` - Fixed System Dependencies table, added to Documentation Map
<!-- SECTION:NOTES:END -->
