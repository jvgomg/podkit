---
id: TASK-292.02
title: P1.2 — Plist parser + tests against captured XML
status: Done
assignee: []
created_date: '2026-05-03 11:29'
updated_date: '2026-05-03 13:18'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8020
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a structured plist-XML parser in `@podkit/ipod-firmware` covering the Apple plist subset that SysInfoExtended uses (dict, key, string, integer, data, array, true, false). Pure module, no dependencies. Tests use real captured XML fixtures from documents/sysinfo-captures/.

See spec doc-032, Scope > New packages > ipod-firmware > plist/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 parsePlist(xml) returns a structured PlistValue tree
- [x] #2 Round-trip parse on all 5 captured XML files in documents/sysinfo-captures/ succeeds
- [x] #3 Malformed input rejection: truncated XML, missing closing tag, unknown element, invalid UTF-8
- [x] #4 All plist element types covered: dict, key, string, integer, data, true, false, array
- [x] #5 No external runtime dependencies
- [x] #6 Unit tests exercise structural and error paths
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented a hand-rolled XML scanner (no external deps) in `packages/ipod-firmware/src/plist/parser.ts`.

**Integer type:** Changed `PlistInteger.value` from `number` to `bigint` to preserve 64-bit values (e.g. FireWireGUID). Downstream TASK-292.07 can use `Number(v.value)` for values known to fit in a safe integer, or format as hex strings.

**Real element:** Added `PlistReal` type and `<real>` parsing (present in all fixtures as `GammaAdjustment`). The spec didn't list it but the fixtures require it. `PlistReal` was added to the `PlistValue` union; `index.ts` was not modified (PlistReal is exported from parser.ts directly if consumers import it).

**Array keys:** Apple SysInfoExtended arrays sometimes include `<key>label</key>` before each dict entry (e.g. `ipod-5g-video-iflash-1tb.xml`, `nano-2g-4gb-green.xml`). The parser skips these orphan keys in array context rather than failing.

**Base64 padding:** Apple occasionally omits trailing `=` padding (observed: "Pedometer" in `nano-7g-16gb-usb.xml`, length 9). The decoder auto-pads to a multiple of 4 before decoding.

**Pre-existing build failures:** `bun run build --filter @podkit/ipod-firmware` and `bun run typecheck` both fail on pre-existing errors in `src/inquiry/scsi/index.ts` (missing `./linux.js` and `./macos.js` modules — stub files for TASK-292.03). These errors existed before this task and are unrelated to the plist parser. Parser code itself has zero TypeScript errors.

**Tests:** 37 new tests (15 fixture round-trips + element coverage + malformed-input rejection) all pass. Total package test count: 52 pass, 0 fail.
<!-- SECTION:NOTES:END -->
