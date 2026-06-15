---
id: TASK-429
title: Fix shortenIpodLabel pass-through for `iPod Video (5.5th Generation)`
status: Done
assignee: []
created_date: '2026-06-15 21:53'
updated_date: '2026-06-15 22:29'
labels:
  - devices-ipod
  - follow-up
  - display
milestone: m-18
dependencies: []
priority: low
ordinal: 144000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`shortenIpodLabel` in `packages/podkit-core/src/device/discovery.ts` (the helper that produces the compact label like `"iPod nano 3G"` from upstream displayName strings) has a known pass-through gap for the 5.5G iPod Video.

Inputs the shortener handles:
- `"iPod nano 3rd generation"` (USB-source) → `"iPod nano 3G"` ✓
- `"iPod nano (3rd Generation)"` (sysinfo/serial-source) → `"iPod nano 3G"` ✓
- `"iPod (5th Generation)"` → `"iPod 5G"` ✓

Input it does NOT handle:
- `"iPod Video (5.5th Generation)"` → falls through unchanged. The `.5th` decimal ordinal isn't matched by either regex; the long string surfaces in scan/list short-label positions.

Documented + pinned by test in `packages/podkit-core/src/device/discovery.test.ts` (`passes through the 5.5G iPod Video displayName unchanged (known shortener gap)`).

## Two fix paths

a. **Extend the regex** to accept decimal ordinals. Quick fix: a single regex change. Adds `"5.5G"` short form. Lowest-effort path.

b. **Restructure upstream** so the shortener doesn't need to parse strings at all (see TASK-428). Higher-effort; eliminates this and similar issues categorically.

If (b) is on the roadmap, do (b). If not, do (a) now and remove the pinned-pass-through test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 5.5G iPod Video renders with a sensible short label (`"iPod Video 5.5G"` or equivalent) in `device scan` / `device list` / `device info`
- [ ] #2 No other shortener inputs regress — full `discovery.test.ts` + `device-scan-render.unit.test.ts` snapshot tests pass
- [ ] #3 The known-gap pinned test is updated or removed (depending on fix approach)
<!-- AC:END -->
