---
id: TASK-298
title: 'Retroactive review: P3 (devices-ipod + devices-mass-storage)'
status: Done
assignee: []
created_date: '2026-05-06 21:55'
updated_date: '2026-05-06 22:12'
labels:
  - device-capability-architecture
  - review-debt
milestone: m-18
dependencies: []
ordinal: 9999
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
P3 (commit `01ecedd`) shipped without an independent sonnet review of the merged 15-sub-task diff. Worker self-reports + lead gate-checks were the only verification.

User caught one accuracy bug manually (nano 7G + iPhone/iPad PIDs missing from unsupported list) — fixed in P3.5. Other areas may have similar gaps that auditing would surface.

This task: dispatch a holistic sonnet review of `01ecedd`. Areas of focus:
- Capability-table parity: 25/29 byte-identical claim — re-verify independently
- Generation-table data accuracy: cross-reference against libgpod 0.8.3 ipod_info_table for every supported generation
- Provider chain coherence: identity → provider → enumeration → CLI surface
- Re-export shim correctness: ipod-models, presets, capability-adapter
- Readiness pipeline split: did stage interdependencies leak through orchestrator boundary
- IpodIdentity rename: any caller still using old name
- DeviceTypeId widening: union split semantics

If review surfaces bugs, fix in P4 cleanup pass.

Backlog task to track gap; no scope until reviewer report comes back.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Holistic sonnet review of P3 (commit 01ecedd) + P3.5 (commit 7022289) completed. Verdict: ship-with-followups. One real bug found: getCapabilities() in devices-ipod returned 0 instead of null for artworkless iPods because IpodGeneration.artworkMaxResolution was still typed as `number` with `0` sentinel (P3.5 changed the public DeviceCapabilities type but missed the producer-side IpodGeneration type). Currently dormant (sync pipeline only reads field for mass-storage embedded path) but becomes live when P4-B wires resolveCapabilities. Fixed inline: IpodGeneration.artworkMaxResolution → number | null, 9 sentinel `0` entries in tables/generations.ts → null, capabilities.ts guard updated, parity test reference + shape assertion updated. Stale comment in devices-mass-storage/src/index.ts also fixed. All 178 devices-ipod tests + 2521 core tests pass.
<!-- SECTION:NOTES:END -->
