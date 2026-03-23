---
id: TASK-193
title: Add sync tag diagnostics to `doctor` command
status: To Do
assignee: []
created_date: '2026-03-23 11:59'
labels:
  - feature
  - diagnostics
  - cli
dependencies:
  - TASK-189
references:
  - packages/podkit-core/src/diagnostics/
  - packages/podkit-core/src/sync/sync-tags.ts
  - packages/podkit-cli/src/commands/doctor.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `doctor` command runs diagnostics on device health but doesn't currently inspect sync tag consistency. Add checks for sync tag data points that could indicate issues or recommend actions.

**Proposed diagnostics:**

1. **File mode mismatch** — Tracks whose sync tag `mode` differs from the current `fileMode` setting. Suggests running `--force-file-mode` (once TASK-192 is done) or `--force-transcode`.

2. **Missing sync tags** — Tracks with no sync tag at all (pre-podkit or manually added). Suggests `--force-sync-tags` to establish baseline.

3. **Preset mismatch** — Tracks whose sync tag quality/encoding/bitrate doesn't match current config. These would normally be caught by `syncTagMatchesConfig` during sync, but surfacing them in doctor gives visibility without running a full sync.

4. **Missing artwork hash** — Tracks with artwork but no `artworkHash` in sync tag. Suggests `--force-sync-tags --check-artwork`.

5. **Stale sync tag version** — Tracks with an older sync tag format version that could benefit from `--force-sync-tags` to upgrade.

These overlap with existing tips but doctor is the right place for a comprehensive health check, while tips are contextual nudges during sync.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Doctor reports file mode mismatches with count and recommendation
- [ ] #2 Doctor reports tracks missing sync tags entirely
- [ ] #3 Doctor reports preset mismatches (quality/encoding/bitrate)
- [ ] #4 Doctor reports tracks with artwork but missing artwork hash
- [ ] #5 Each diagnostic includes actionable recommendation
- [ ] #6 JSON output includes sync tag diagnostics
- [ ] #7 Tests cover each diagnostic scenario
<!-- AC:END -->
