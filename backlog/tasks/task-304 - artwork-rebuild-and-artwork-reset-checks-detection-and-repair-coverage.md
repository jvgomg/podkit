---
id: TASK-304
title: 'artwork-rebuild and artwork-reset checks: detection and repair coverage'
status: To Do
assignee: []
created_date: '2026-05-08 07:22'
updated_date: '2026-05-12 11:56'
labels:
  - testing
  - doctor
  - artwork
  - vm-coverage
milestone: m-19
dependencies: []
priority: medium
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify the artwork integrity diagnostic and its two repair paths across realistic ArtworkDB / ithmb states. Today's e2e tests cover the simple cases (clean, fully-corrupt) but skip the partial-corruption and edge cases that have historically produced silent regressions (artwork rebuild leaving sync tags inconsistent, reset on already-empty DB).

`artwork-rebuild` is both a detection check and a repair: it scans entries in ArtworkDB, validates that each thumbnail's offset is within its ithmb file, and on repair re-extracts artwork from a source collection and updates sync tags. `artwork-reset` is repair-only — it clears all artwork without needing a source collection.

For every test, run `podkit doctor --device <fixture> --json --no-system` (and the appropriate repair command), and assert on the `artwork-rebuild` entry in `checks[]`. For repair tests, also assert on the repair JSON output (`success`, `details.matched`, `details.errors`, `details.noSource`, `details.noArtwork`).

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` from `@podkit/device-testing`; use `DevicePersona.partitionLayout` and `expectedCapabilities` to set up injectable fakes; artwork state variations are test-local mutations of persona data
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner against the `ipod-nano-7g-populated` persona (which has artwork-relevant state)
- See `agents/device-testing.md` and ADR-016/ADR-017 for the full harness architecture
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No ArtworkDB and no ithmb files → status=skip, summary indicates no artwork to verify
- [ ] #2 ArtworkDB present but zero entries → status=pass, summary indicates 'no artwork entries'
- [ ] #3 ArtworkDB present + N healthy entries with valid offsets → status=pass, details.totalEntries=N, details.corruptEntries=0
- [ ] #4 ArtworkDB present + ithmb file truncated such that some offsets are out-of-bounds → status=fail+repairable, details.corruptEntries>0, details.healthyEntries>0, details.corruptPercent reflects ratio
- [ ] #5 ArtworkDB present + ithmb files all truncated to zero → status=fail+repairable, details.corruptEntries equals totalEntries, details.corruptPercent=100
- [ ] #6 ArtworkDB present + entries reference an ithmb file that does not exist on disk → status=fail+repairable, details indicate missing file
- [ ] #7 Repair --repair artwork-rebuild on partial corruption with full source match: success, details.matched=trackCount, details.errors=0; subsequent doctor reports pass
- [ ] #8 Repair on partial corruption with partial source match: details.matched<trackCount, details.noSource>0; tracks without source have art= cleared from sync tag; subsequent doctor reports pass
- [ ] #9 Repair preserves quality and encoding fields in sync tag (only mutates art=) — verify via track sync tag inspection
- [ ] #10 Repair --dry-run prints planned actions without modifying ArtworkDB or ithmb files
- [ ] #11 Repair fails clearly when --collection points at a missing/invalid music collection
- [ ] #12 Repair when run twice in a row on the same device: first run repairs, second run is a no-op (details.matched accurate, details.errors=0)
- [ ] #13 artwork-reset repair clears all artwork (ArtworkDB and ithmb files) regardless of source collection; subsequent doctor reports pass or skip
- [ ] #14 artwork-reset --dry-run prints planned action without modifying files
- [ ] #15 Both checks include scope: 'device' and applicableTo includes 'ipod' only (mass-storage devices skip them)
<!-- AC:END -->
