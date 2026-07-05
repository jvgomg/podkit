---
id: TASK-458
title: 'Device Access Tiers — read-only support, provenance & format docs (epic)'
status: In Progress
assignee: []
created_date: '2026-07-05 14:22'
updated_date: '2026-07-05 22:55'
labels:
  - device-capability
  - read-only
  - discovery
  - shuffle
  - docs
  - epic
milestone: m-18
dependencies: []
references:
  - >-
    backlog/docs/doc-056 -
    PRD-Device-Access-Tiers-—-Read-Only-Support-Provenance-iPod-Database-Format-Docs.md
  - adr/adr-024-device-access-tiers.md
ordinal: 209000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent epic implementing **doc-056 (PRD: Device Access Tiers)** and **[ADR-024](adr/adr-024-device-access-tiers.md)**.

Replace the binary `IpodGeneration.supported` flag with a tri-state `access` tier (`syncable` / `read-only` / `none`) that gates behavior, plus an orthogonal `verified` provenance axis (`hardware` / `inferred`) that gates nothing and documents confidence. Propagate through discovery and device resolution so read-only devices (iPod shuffle 3g/4g, nano 6g) are discovered, read, and archived — only writes are refused. Stand up a growing, tiered format-docs corpus (public support matrix + internal `documents/formats/`), all fed by one exported `getSupportMatrix()`.

Origin: a mounted iPod shuffle 4g reported "connected but not mounted" by `device archive`, yet `device -d <path> music` read 89 tracks. Root cause was the binary `supported` flag collapsing "can't write" into "unsupported," which then orphaned the mounted volume in discovery.

Sub-tasks 1–7 are AFK and land the whole change. Sub-task 8 is the HITL capstone: end-to-end verification on real hardware (iPod shuffle 4g), run once all AFK work is merged.

ADR-024 and the format corpus scaffold (`documents/formats/README.md` + `itunessd-bdhs.md`) were authored alongside the PRD and already exist on the branch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 7 AFK sub-tasks are Done and merged
- [x] #2 A mounted iPod shuffle 4g is discovered, readable, and archivable; sync/init/add refuse with DEVICE_READ_ONLY; no "connected but not mounted" for a mounted device
- [x] #3 Public supported-devices matrix and internal generations matrix are both fed by getSupportMatrix() and cannot drift
- [ ] #4 HITL capstone (sub-task 8) verified on real hardware
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AFK slices complete on branch feat/device-access-tiers (worktree). 7 commits:
- d6e6ec13 ADR-024 + documents/formats/ corpus (bdhs reference)
- bf3496cd 458.01 two-axis {access, verified} model (supported: boolean removed)
- 829b80b7 458.02 macOS whole-disk enumeration fix (the actual bug) — live-verified
- 5d44cbe1 458.03 access-aware read-only refusal wording — live-verified
- f1bff16b 458.05 generations.md generated from getSupportMatrix() + drift test
- 9ddc67f2 458.04 public supported-devices matrix (tri-state, fed by getSupportMatrix())
- 25450d29 doctor archive hint for read-only devices

Root-cause pivot: the reported "connected but not mounted" was NOT a classification bug (ADR §3's original premise). Live diagnosis on the connected shuffle 4g showed it writes its filesystem to a bare whole disk (disk4, no partition map), and macOS enumeration only collected diskNsM partitions. Fix surfaces partitionless whole disks. ADR §3 rewritten to the real mechanism.

Live-verified on real hardware: device scan shows the shuffle mounted+correlated; music lists 89 tracks; archive --dump-only dumps 158 files; sync refuses with the read-only message; doctor points at archive.

Deferred to 458.09 (follow-up): doctor-runs-diagnostics-on-read-only, path-mode generation resolution (info Support line), libgpod write backstop. All low-value/higher-effort refinements; none block the fix.

Remaining: 458.08 HITL capstone (real-device acceptance run) + 458.09 follow-up polish.

Note: full unit suite green in worktree after generating static fixtures (fixtures are gitignored; a fresh worktree needs `bun run --filter @podkit/test-fixtures generate-static-fixtures`).
<!-- SECTION:NOTES:END -->
