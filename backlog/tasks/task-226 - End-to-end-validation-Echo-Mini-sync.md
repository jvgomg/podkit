---
id: TASK-226
title: 'End-to-end validation: Echo Mini sync'
status: To Do
assignee: []
created_date: '2026-03-23 20:31'
updated_date: '2026-03-24 16:11'
labels:
  - testing
  - e2e
milestone: 'Additional Device Support: Echo Mini'
dependencies:
  - TASK-223
  - TASK-224
  - TASK-225
references:
  - packages/e2e-tests/
  - devices/echo-mini.md
documentation:
  - backlog/docs/doc-020 - Architecture--Multi-Device-Support-Decisions.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Validate the full sync pipeline works end-to-end for the Echo Mini. This is the final task — when this passes, the milestone is complete and you can sync your Echo Mini.

**What to validate:**

1. **Dry run** — `podkit sync --dry-run` with Echo Mini as target device shows correct plan:
   - Tracks to add with correct transcode/copy decisions based on Echo Mini codec support
   - Artwork handling matches Echo Mini capabilities (sidecar + embedded resize)
   - No iPod-specific operations in the plan

2. **Actual sync** — `podkit sync` transfers music to Echo Mini:
   - Files land in correct directory structure
   - Metadata tags are correct and readable by device
   - Sidecar artwork created in correct format/location
   - Embedded artwork resized correctly
   - Device plays the synced music correctly

3. **Incremental sync** — modify source collection, sync again:
   - New tracks added, removed tracks deleted
   - Changed artwork updated (both sidecar and embedded)
   - No unnecessary re-transfers

4. **Edge cases:**
   - Device with pre-existing music not managed by podkit (should be preserved)
   - Source has formats the Echo Mini can't play natively (should transcode)
   - Large collection (performance/memory acceptable)

**Test approach:**
- Automated tests against a temporary directory simulating a mass-storage device (no real hardware needed for CI)
- Manual validation on actual Echo Mini hardware for final sign-off
- Consider adding a mass-storage E2E test profile to the existing e2e-tests package (similar to the dummy iPod profile)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dry run against mass-storage device shows correct sync plan
- [ ] #2 Full sync transfers files with correct structure, metadata, and artwork
- [ ] #3 Incremental sync correctly adds, removes, and updates tracks
- [ ] #4 Pre-existing unmanaged music on device is preserved
- [ ] #5 Formats unsupported by device are transcoded correctly
- [ ] #6 Automated E2E test profile for mass-storage devices added to e2e-tests
- [ ] #7 Manual validation on real Echo Mini hardware passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Research findings relevant to E2E (DOC-022)

**Test scenarios informed by device behavior:**
- Progressive JPEG artwork → must be converted to baseline during sync
- Opus source files → must be transcoded (only format needing it)
- Multi-disc album → album name gets '(disc N)' suffix
- Compound tracknumber in source → cleaned to plain integer
- Filename generation → verify FAT32/exFAT safe characters
- Pre-existing music on device → verify not deleted
- Dual-volume → syncs to correct volume

**Test device available:** Firmware 3.2.0, Hardware 1.2.0, 128GB SD card
<!-- SECTION:NOTES:END -->
