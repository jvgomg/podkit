---
id: TASK-123
title: Swap podkit-core to use @podkit/ipod-db and run E2E validation
status: To Do
assignee: []
created_date: '2026-03-12 10:55'
labels:
  - phase-5
  - integration
milestone: ipod-db Core (libgpod replacement)
dependencies:
  - TASK-122
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Change the import in @podkit/core from `@podkit/libgpod-node` to `@podkit/ipod-db` and validate the entire stack works end-to-end.

**Import swap:**
- `packages/podkit-core/src/ipod/database.ts` line 9: change import from `@podkit/libgpod-node` to `@podkit/ipod-db`
- Verify all type imports resolve (TrackHandle, Playlist, Track, etc.)
- May need thin type compatibility layer if handle types differ

**Validation chain:**
1. All podkit-core unit tests pass
2. All podkit-core integration tests pass
3. All podkit-cli tests pass
4. All E2E tests pass (dummy iPod): `bun run test:e2e`
5. E2E tests with real iPod if available: `IPOD_MOUNT=/Volumes/iPod bun run test:e2e:real`

**Hardware testing:**
- Create database with ipod-db → sync to physical iPod Classic (hash58) → verify:
  - Database loads (not rejected by firmware)
  - Tracks play correctly
  - Artwork displays
  - Playlists appear
- If available, test iPod Video (no hash) and iPod Nano
- Document results in supported-devices.md

**Changeset:**
Create changeset for `@podkit/core` (minor version bump) noting the backend change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Import in podkit-core changed from libgpod-node to ipod-db
- [ ] #2 All podkit-core unit tests pass
- [ ] #3 All podkit-core integration tests pass
- [ ] #4 All CLI tests pass
- [ ] #5 All E2E dummy iPod tests pass
- [ ] #6 Hardware validation performed on at least one physical iPod
- [ ] #7 Hardware test results documented in supported-devices.md
- [ ] #8 Changeset created for @podkit/core
<!-- AC:END -->
