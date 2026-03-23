---
id: TASK-209
title: Review `podkit device music` output for transfer mode changes
status: Done
assignee: []
created_date: '2026-03-23 14:36'
updated_date: '2026-03-23 18:13'
labels:
  - feature
  - cli
  - ux
milestone: 'Transfer Mode: iPod Support'
dependencies:
  - TASK-200
references:
  - packages/podkit-cli/src/commands/device.ts
documentation:
  - backlog/docs/doc-011 - PRD--Transfer-Mode.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add transfer mode visibility to device inspection and dry-run output. Users should be able to see transfer mode information when inspecting a device — including what's configured, flagging inconsistency, and using verbose for more detail. Follows the same pattern as sync tag data display.

**PRD:** DOC-011 (Transfer Mode)

**Stats view (device music, device video, dry-run sync):**
- Add transfer mode breakdown alongside existing sync tag summary
- Show configured transfer mode when available
- Flag inconsistency: tracks with a different transfer mode than configured
- Track missing `transfer` field in sync tags (like "missing artwork hash" for artwork)
- `-v` verbose shows per-mode counts; default shows just the issue summary

**Track fields (`--tracks --fields`):**
- Add `syncTagTransfer` field — renders the `transferMode` value from parsed sync tag
- Works for both music and video track listings
- Table: shows value like `fast`, `optimized`, `portable`, or `-` if missing
- JSON: includes `syncTagTransfer` string or null

**Dry-run sync:**
- Show transfer mode summary similar to device inspection
- Show configured transfer mode and count of mismatched tracks

**NOT in scope:**
- No `--transfer-mode` filter flag
- No speculation or diffing in device commands — only show what's on the device
- Device commands show what IS on device; dry-run shows what WILL change
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Stats view shows transfer mode distribution (per-mode track counts)
- [x] #2 Stats view flags tracks with missing transfer field in sync tags
- [x] #3 Stats view shows configured transfer mode and flags inconsistency with on-device data
- [x] #4 Verbose (-v) shows per-mode breakdown; default shows summary/issue count
- [x] #5 syncTagTransfer field available in --tracks --fields for music and video
- [x] #6 syncTagTransfer renders correctly in table, JSON, and CSV formats
- [x] #7 Dry-run sync output includes transfer mode summary
- [x] #8 Tests cover stats rendering, field display, and dry-run output
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added transfer mode visibility to device inspection and dry-run output.

**Track fields (`display-utils.ts`):**
- New `syncTagTransfer` field available via `--tracks --fields syncTagTransfer`
- Renders transfer mode value in table/CSV/JSON (follows syncTagQuality/syncTagEncoding/syncTagArtwork pattern)

**Stats view (`display-utils.ts`):**
- `computeStats()` tracks `transferModeCounts` and `syncTagMissingTransfer`
- `formatStatsText()` shows Transfer Mode section: ✓ Consistent (single mode), ◐ Mixed (multiple modes), ◐ Missing transfer field
- Verbose (`-v`) shows per-mode count breakdown with (missing) count
- Section only appears when sync-tagged tracks exist

**Device info (`device.ts`):**
- `formatSyncTagSummary()` includes missing transfer mode count in one-liner
- Live status computation tracks `syncTagMissingTransfer`

**Dry-run (`music-presenter.ts`):**
- Shows `Transfer mode: <mode>` in config block
- JSON output includes `transferMode` field

**Tests:** 18 new tests covering field rendering, stats computation, stats formatting (consistent/mixed/all-legacy/verbose/no-sync-tags), and formatSyncTagSummary. 58 CLI tests pass, build clean.
<!-- SECTION:FINAL_SUMMARY:END -->
