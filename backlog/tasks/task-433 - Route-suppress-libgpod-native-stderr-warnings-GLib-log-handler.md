---
id: TASK-433
title: Route/suppress libgpod native stderr warnings (GLib log handler)
status: To Do
assignee: []
created_date: '2026-06-23 17:52'
labels:
  - libgpod-node
  - native
  - ux
  - diagnostics
dependencies: []
references:
  - packages/libgpod-node/native/gpod_binding.cc
  - packages/libgpod-node/native/track_operations.cc
  - packages/podkit-core/src/diagnostics/
documentation:
  - agents/libgpod-node.md
  - backlog/docs/doc-048 - PRD-Device-Reset-Rename-Fresh-Setup.md
ordinal: 173000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
libgpod writes warnings directly to the process's stderr via GLib (`g_warning`/`g_log`), bypassing podkit's output layer. The most visible case is parsing a database with orphaned playlist members, which floods the terminal:

```
** (process:NNNN): WARNING **: Itdb_Track ID '0' not found.
```

(One such line repeats per orphaned member.) These appear on any command that opens/parses the iTunesDB (`device music`, `device list`, `device info`, the read step of `device reset`, etc.) whenever the on-disk DB carries stale/phantom track references — which can come from external tools (iTunes, GNUpod), a crashed sync, or a corrupt DB. They are noise to the user and are not surfaced through podkit's normal text/JSON output or diagnostics.

Note: `device reset` now recreates a pristine DB (see doc-048 / task-432), so it no longer *creates* these. This task is about the remaining case where podkit *reads* an already-corrupt/foreign DB and the user shouldn't see raw GLib spew.

## Approach
Install a GLib log handler in the libgpod-node native addon so libgpod's log output is captured rather than written straight to fd 2:
- In the addon's `Init` (`packages/libgpod-node/native/gpod_binding.cc`), register `g_log_set_handler` for the relevant log domain(s) (and/or `g_log_set_default_handler`) — first confirm the exact domain libgpod uses (likely the default/NULL domain or "libgpod").
- Route captured messages to podkit's diagnostic logger surface rather than dropping them entirely, so they remain available under a verbose/debug flag. Coordinate with the existing diagnostics framework (`packages/podkit-core/src/diagnostics/`) and the libgpod-node logging surface; see `agents/libgpod-node.md` and `agents/ipod-firmware.md` (the firmware package already has a diagnostic logger surface that may be a good model).
- Default behaviour: do not print these to stderr. Make them visible only at a verbose/debug level (decide the exact gating).

## Constraints / gotchas
- Native C++ change → requires a native rebuild (`node-gyp rebuild`) AND a prebuild refresh: the build uses `node scripts/has-prebuild.cjs || bun run build:native`, and `prebuildify` ships prebuilds in `packages/libgpod-node/prebuilds/`. A stale prebuild would mask the change — make sure the prebuilds are regenerated (and cross-platform builds covered) or document how.
- Don't blanket-swallow ALL libgpod output — genuine errors should still reach diagnostics. Distinguish benign parse warnings from real failures where feasible.
- Read `agents/libgpod-node.md` (documents the `removeTrack()` doesn't-remove-from-playlists quirk and other libgpod edge cases) before starting.

## Acceptance Criteria
<!-- AC:BEGIN -->
- Opening/parsing a corrupt iTunesDB no longer prints raw GLib `WARNING **: Itdb_Track ID ... not found` (or similar) to stderr by default.
- The warnings are still retrievable via podkit's diagnostics/verbose path (not silently lost).
- Real libgpod errors are not hidden.
- Native rebuild + prebuild refresh path is handled/documented so the handler actually takes effect in distributed binaries.
- A test or documented manual repro covers the suppression (e.g. a fixture DB with an orphaned playlist member).
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 Opening/parsing a corrupt iTunesDB no longer prints raw GLib 'Itdb_Track ID ... not found' (or similar) warnings to stderr by default
- [ ] #2 Warnings remain retrievable via podkit diagnostics/verbose path (not silently lost)
- [ ] #3 Genuine libgpod errors are not hidden
- [ ] #4 Native rebuild + prebuild refresh is handled/documented so the handler takes effect in distributed binaries
- [ ] #5 Test or documented manual repro covers the suppression (fixture DB with an orphaned playlist member)
<!-- AC:END -->
