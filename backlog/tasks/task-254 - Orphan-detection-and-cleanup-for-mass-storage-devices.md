---
id: TASK-254
title: Orphan detection and cleanup for mass-storage devices
status: To Do
assignee: []
created_date: '2026-03-30 14:08'
updated_date: '2026-03-31 14:24'
labels:
  - mass-storage
  - diagnostics
dependencies:
  - TASK-261
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The doctor command's orphan detection currently only works for iPod devices (scans `iPod_Control/Music/`). Mass-storage devices need equivalent functionality — detecting files in content directories that aren't tracked in the `.podkit/state.json` manifest.

**Key design decisions (from design review 2026-03-31):**

1. **Scope to configured content directories only.** The directories to scan come from the device's content path configuration (device preset, config file, CLI arguments, env vars — e.g., `musicDir`, `videoDir`). Files outside these directories are completely ignored — they're the user's business.

2. **Mirrors iPod orphan model.** iPod orphan check scans `iPod_Control/Music/F*/` — the directories the iPod database controls. Mass-storage orphan check scans the equivalent: the configured content directories (e.g., `Music/`, `Video/`).

3. **"Managed" = tracked in state.json manifest.** A file in a content directory that isn't in `managedFiles` is an orphan. This is the same distinction used by `--delete` (which only removes managed files — see TASK-261).

4. **Common scenario: content path changes.** When users change `musicDir` from `Music` to `Tunes`, old files at `Music/` become orphans. Doctor should detect these by scanning both current and any previously-used content directories if discoverable, or at minimum flagging that old directories exist with content.

Should support:
- Detecting unmanaged files in configured content directories
- Offering cleanup (delete orphans)
- Awareness of content path configuration (scan the right directories based on device preset, config, args, envs)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Orphan check scans configured content directories (musicDir, videoDir) on mass-storage devices
- [ ] #2 Files in content directories not tracked in state.json managedFiles are reported as orphans
- [ ] #3 Files outside content directories are ignored entirely
- [ ] #4 Repair mode deletes orphaned files and cleans up empty directories
- [ ] #5 Content directory paths are resolved from full config chain (device preset → config file → args → env)
- [ ] #6 E2E test covers orphan detection and cleanup on mass-storage device
<!-- AC:END -->
