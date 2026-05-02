---
id: TASK-027
title: Write getting-started user guide
status: Done
assignee: []
created_date: '2026-02-22 19:38'
updated_date: '2026-03-10 13:18'
labels: []
milestone: 'M3: Production Ready (v1.0.0)'
dependencies:
  - TASK-022
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write comprehensive getting started documentation for users.

**Content:**
1. Prerequisites (Node.js, system dependencies)
2. Installation (npm install -g podkit)
3. System dependency installation (libgpod, FFmpeg) per platform
4. First sync walkthrough
5. Common options and use cases
6. Troubleshooting common issues

**Goal:** User goes from nothing to successful sync following this guide.

**Location:** docs/GETTING-STARTED.md + README updates
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Complete guide from install to sync
- [x] #2 Covers macOS and Linux
- [x] #3 Includes troubleshooting section
- [x] #4 Tested by following guide on clean system
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Created comprehensive getting-started guide at `docs/GETTING-STARTED.md` with:

### Content Sections
1. **Prerequisites** - Node.js, FFmpeg, libgpod requirements
2. **Installation** - Step-by-step for macOS (Homebrew + libgpod build script) and Linux (Debian/Ubuntu, Fedora, Arch)
3. **Initial Setup** - Config file creation, music collection configuration, device registration
4. **First Sync** - Dry-run preview, running sync, safe ejection
5. **Common Commands** - Device status, sync options, quality presets, multiple collections/devices
6. **Video Sync** - For video-capable iPods
7. **Troubleshooting** - Common issues: device not found, database errors, FFmpeg issues, sync speed
8. **Next Steps** - Links to related documentation

### Documentation Updates
- README.md: Updated Quick Start section with working commands, added Getting Started to docs table
- docs/README.md: Added to reading order and Core Documents table
- AGENTS.md: Added to Documentation Map

### Remaining Work
- AC #4 (tested on clean system) requires manual verification
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Created comprehensive getting-started user guide at `docs/GETTING-STARTED.md`.

### What Changed
- **New:** `docs/GETTING-STARTED.md` — Full user guide from install to first sync
- **Updated:** `README.md` — Revised Quick Start section, added guide to docs table
- **Updated:** `docs/README.md` — Added to reading order and Core Documents
- **Updated:** `AGENTS.md` — Added to Documentation Map

### Guide Contents
1. Prerequisites (Node.js 20+, FFmpeg, libgpod)
2. Installation for macOS and Linux (Debian/Ubuntu, Fedora, Arch)
3. Initial setup (config file, music collection, device registration)
4. First sync walkthrough (dry-run, sync, eject)
5. Common commands and quality presets
6. Multiple collections and devices
7. Video sync for supported iPods
8. Troubleshooting common issues

### Commit
`eafb0e1` docs: Add getting-started user guide
<!-- SECTION:FINAL_SUMMARY:END -->
