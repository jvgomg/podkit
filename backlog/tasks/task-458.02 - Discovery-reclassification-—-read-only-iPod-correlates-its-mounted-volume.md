---
id: TASK-458.02
title: Discovery reclassification — read-only iPod correlates its mounted volume
status: Done
assignee: []
created_date: '2026-07-05 14:23'
updated_date: '2026-07-05 22:15'
labels:
  - device-capability
  - read-only
  - discovery
milestone: m-18
dependencies:
  - TASK-458.01
parent_task_id: TASK-458
ordinal: 211000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix the reported bug at its root. In `@podkit/core` discovery, a `read-only` generation classifies as `kind: 'ipod'` (via `classifyAsIpod`) so the existing block-correlation path in `reconcileDiscoveredDevices` maps its mounted volume automatically. `kind: 'unsupported'` shrinks to mean `access: 'none'` (iOS, nano 7g). No new correlation logic — the "USB only" orphaning was upstream misclassification.

Keystone regression test: a mounted read-only shuffle (USB read-only + mounted block) reconciles to a single correlated `kind:'ipod'` record carrying its mount path — NOT an orphaned "USB only" entry; an `access:'none'` device stays USB-only `unsupported`.

Parent: TASK-458. PRD: doc-056. ADR: adr/adr-024-device-access-tiers.md §3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Live diagnosis identified the true root cause: macOS enumeration dropped whole-disk volumes (shuffle 4g filesystem is on bare disk4, no partition map), so the mounted volume never reached classification
- [x] #2 parseDiskIdentifiers surfaces a partitionless whole disk (diskN with no diskNsM sibling); partitioned container disks still represented by their partitions
- [x] #3 device scan shows a mounted read-only shuffle as a mounted iPod with its volume path (isMounted:true, correlated) — verified live on real hardware
- [x] #4 Regression test covers whole-disk enumeration via the public scan() surface with a synthetic diskutil plist
- [x] #5 Full @podkit/core suite (3401 tests) + typecheck green
- [x] #6 ADR-024 §3 rewritten to the real mechanism (original kind-reclassification premise was wrong)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PIVOT from the planned approach. Live diagnosis on the connected shuffle 4g disproved ADR-024 §3's premise:

- Unsupported iPods (shuffle/touch/iOS) are ALREADY kind:'ipod' with an unsupportedReason; kind:'unsupported' is only for non-iPod devices. So the bug was never misclassification.
- True cause: the shuffle 4g writes its FAT filesystem to the bare disk (disk4, no partition map). macOS parseDiskIdentifiers only collected diskNsM partitions and explicitly dropped whole disks, so the mounted volume never entered enumeration/reconcile. Path-mode worked because `diskutil info <path>` bypasses enumeration.

Fix (commit 829b80b7): parseDiskIdentifiers now also surfaces a partitionless whole disk (diskN with no diskNsM sibling). getPlatformDeviceInfo still gates on it being a real mounted volume. Live-verified: shuffle went from usb-only/isMounted:false to isMounted:true, mountPoint /Volumes/NIKKI'S IPO, identifier disk4, correlated to USB.

readiness still 'unsupported' (expected) — making the read-only device readable/archivable is the resolver gate in 458.03.

Scope moved: the `access`-through-discovery threading was folded into 458.03 (where the gate consumes it) rather than done here, keeping this slice a focused enumeration fix.

Regression test: packages/podkit-core/src/device/platforms/macos.test.ts — drives scan() with a synthetic plist (whole-disk disk4 iPod + partitioned disk5), asserts disk4 surfaces and disk5 whole-disk is never queried.
<!-- SECTION:NOTES:END -->
