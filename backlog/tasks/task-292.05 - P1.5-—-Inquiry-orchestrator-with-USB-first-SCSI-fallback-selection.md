---
id: TASK-292.05
title: P1.5 — Inquiry orchestrator with USB-first / SCSI-fallback selection
status: Done
assignee: []
created_date: '2026-05-03 11:29'
updated_date: '2026-05-03 15:06'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8050
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the deep-module entry point `inquireFirmware(fingerprint)` that probes available methods, runs USB first (richer data on 5G+), falls back to SCSI on USB failure, parses the resulting plist XML, and returns a structured `ParsedFirmware`.

The orchestrator is the single public entry point for firmware inquiry. Selection logic is internal — callers do not specify a method.

See spec doc-032, Scope > inquiry/orchestrator.ts and inquiry/selection.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 inquireFirmware(fingerprint) returns ParsedFirmware | null with USB-first / SCSI-fallback selection
- [x] #2 Transports injectable for testing (opts.transports)
- [x] #3 Unit tests cover: USB-success-no-SCSI, USB-fail-SCSI-success, both-fail-graceful, malformed-XML-rejection, identity-extraction-failure
- [x] #4 On a USB-inquiry-supporting device, never invokes SCSI
- [x] #5 On a USB-inquiry-failing device, falls back to SCSI cleanly
- [x] #6 Returns null without throwing when both methods fail or device returns invalid data
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented inquiry orchestrator at packages/ipod-firmware/src/inquiry/orchestrator.ts with helper at packages/ipod-firmware/src/inquiry/selection.ts. Public surface (index.ts) now also exports `chooseTransports`, `SelectionPlan`, and `TransportOptions`.

## Decisions

- **SelectionPlan / chooseTransports split**: extracted the 4-case availability → plan mapping into a pure function in `selection.ts` so it can be unit-tested in isolation (4 tests). Keeps `orchestrator.ts` focused on dispatch and parsing rather than enumerating availability combinations.
- **Malformed XML on USB success does NOT trigger SCSI fallback**: a device that returned bytes is reachable; bytes failing to parse is a different problem (corrupt firmware, truncated transfer, encoding mismatch) than transport failure. Silently re-querying via SCSI would hide the real signal. Returns `null` instead. Documented in module TSDoc rule 3.
- **USB-failure logging**: `console.debug` placeholder with TODO to route via core's logger when wired up in TASK-292.08. Per spec, USB failure does not propagate to the caller.
- **Probe DI**: extended `InquireOptions` with `availability` (deterministic snapshot) and `probeOptions` (forwarded to `probeInquiryMethods`) so tests don't need `clearProbeCache()` choreography.

## Tests added

- `selection.test.ts` — 4 cases: usb-only, scsi-only, usb-then-scsi, none.
- `orchestrator.test.ts` — 8 cases:
  1. USB-success → ParsedFirmware, SCSI not called
  2. USB-throw → SCSI fallback succeeds → ParsedFirmware
  3. USB-success-malformed-bytes → null, SCSI not called (per documented rule)
  4. USB-throw + SCSI-throw → null (no exception out)
  5. USB returns parseable plist with no identity → null, SCSI not called
  6. availability=none → null, neither transport called
  7. availability=scsi-only → USB not called, SCSI succeeds
  8. timeoutMs forwarded to both transports

All 169 tests pass (10 files).

## Hardware validation (PARTY IPOD nano 2G, vendor 05ac, product 1260, serial 000A27001A0647CB)

Ran `bun packages/ipod-firmware/inquire-scratch.ts` (script removed after run, not committed):

```
availability: scsi=true, usb=true
[ipod-firmware] USB inquiry failed, falling back to SCSI: USB control transfer failed (bus 1, device 0)
firewireGuid: 000A27001A0647CB
serialNumber: YM7275YSVQH
familyId: 9
firmwareVersion: 1.1.3
ramBytes: 33554432
audioCodecs count: 6
rawXml length: 6279
```

Exact match against `documents/test-devices.md` for nano 2G (GUID, serial, FamilyID 9, firmware 1.1.3, ~6280 byte XML). Confirms the orchestrator's USB-fail → SCSI-fallback path works end-to-end on real hardware. TASK-292.10 unblocked for HITL coverage of remaining devices.

## Quality gates

- typecheck: pass
- bun test (ipod-firmware): 169 pass / 0 fail
- lint: 0 errors / 14 pre-existing warnings (none from new files)
- build @podkit/ipod-firmware: success
<!-- SECTION:NOTES:END -->
