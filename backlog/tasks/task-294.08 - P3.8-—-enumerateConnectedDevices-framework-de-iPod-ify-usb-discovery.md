---
id: TASK-294.08
title: P3.8 — enumerateConnectedDevices framework; de-iPod-ify usb-discovery
status: To Do
assignee: []
created_date: '2026-05-03 11:33'
labels:
  - device-capability-architecture
  - phase-3
milestone: m-18
dependencies: []
documentation:
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
parent_task_id: TASK-294
ordinal: 10080
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `core/device/enumeration.ts` with `enumerateConnectedDevices({ providers })`. Walk USB devices via existing usb-discovery infrastructure; ask each provider in `matches` order; return `EnumeratedDevice[]` with USB connection info plus provider-produced identity.

De-iPod-ify `usb-discovery.ts`: remove the hardcoded Apple VID `0x05ac` filter; discovery becomes a pure USB walk that returns all candidate devices. Classification is the providers' job.

The unsupported-iPod logic (Shuffle 3G/4G, nano 6G, iOS) moves into `@podkit/devices-ipod`'s identity logic — the iPod provider returns an identity tagged as unsupported rather than the discovery layer rejecting it.

See spec doc-034, Scope > Core changes > Enumeration framework.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 enumerateConnectedDevices({providers}) walks USB tree and returns identified devices
- [ ] #2 Provider matching is in caller-supplied order; first match wins
- [ ] #3 Unmatched USB devices appear in result without identity
- [ ] #4 usb-discovery.ts no longer hardcodes Apple VID
- [ ] #5 Unsupported-iPod logic moved to @podkit/devices-ipod identity (returns identity with notSupported tag)
- [ ] #6 Unit tests cover provider ordering, mixed device list (iPod + Echo Mini), unmatched fallthrough
- [ ] #7 Existing usb-discovery tests pass (or migrate to new structure)
<!-- AC:END -->
