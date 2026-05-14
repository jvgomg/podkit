---
id: TASK-324
title: 'Phase 5: persona registry expansion'
status: To Do
assignee: []
created_date: '2026-05-11 22:56'
updated_date: '2026-05-14 22:38'
labels:
  - testing
  - vm-coverage
  - fixtures
milestone: m-19
dependencies:
  - TASK-321
documentation:
  - documents/test-devices.md
  - documents/sysinfo-captures/
priority: medium
ordinal: 800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rolling parent task for expanding the persona registry beyond what landed in TASK-321.02.

**Status update (2026-05-13):** TASK-321.02 captured 14 personas — far beyond the originally-planned 3 starters — so most of this task's positive-case targets are already landed. What remains is **state variants**, **synthesised rejection cases**, and **firmware variants**.

**Hardware inventory**: `documents/test-devices.md` is the canonical list of physical devices available for capture, with USB Product IDs, Apple serials, and capture-status notes per device. Update that doc as new personas are captured.

**Already captured in TASK-321.02** (no longer in this task's scope):
- ✓ `ipod-video-5g-iflash-1tb` (covers `ipod-video-5g-fresh`)
- ✓ `ipod-nano-7g-space-gray` + `ipod-nano-7g-blue` (covers `ipod-nano-7g`)
- ✓ `ipod-nano-4g-black` (covers `ipod-nano-4g`)
- ✓ `ipod-nano-3g-black` (covers `ipod-nano-3g`)
- ✓ `ipod-nano-2g-green` (covers `ipod-nano-2g`)
- ✓ `ipod-mini-2g-pink` (covers `ipod-mini-2g`)
- ✓ `echo-mini` (covers `echo-mini-empty`)
- ✓ `ipod-touch-5g-unsupported` (covers `ipod-touch-not-supported`)

**Bonus captures landed in TASK-321.02 — not originally planned, but registry now contains:**
- `sony-nw-hd5`, `sony-nw-a1000`, `sony-nw-a1200`, `sony-nw-a3000`, `sony-nwz-e384` (5 Sony Walkmans, rejection cases with rich probe data + family-level profiles in `devices/`)

**Still to do — positive state variants** (require physical hardware in a particular state):
- `ipod-video-5g-corrupt-db` — iPod 5G Video with deliberately corrupted iTunesDB. Exercises the repair path. Capture from existing 5G Video unit after running a controlled corruption (truncate iTunesDB / scramble checksum).
- `echo-mini-populated` — Echo Mini DAP with content loaded. Pairs with the existing `echo-mini` empty-state persona to exercise sync-target detection on populated mass storage.

**Still to do — firmware variants:**
- `ipod-classic-rockbox` — iPod with Rockbox firmware installed. Tests firmware-variant capability synthesis. Requires Rockbox install on existing hardware (e.g. the iPod 5G Video). Coordinate with the user before installing — Rockbox install is reversible but a multi-hour commitment.

**Still to do — synthesised rejection personas** (no hardware needed):
- `ipod-shuffle-not-supported` — iPod shuffle. NOT in user's inventory. Synthesise from PIDs in `packages/devices-ipod/src/tables/unsupported.ts` (search for "shuffle"); set `usbDescriptor` + `unsupportedReason` only, no host-probe data. `expectedCapabilities: null`, `expectedReadiness.level: 'unsupported'` (once TASK-331 lands).
- `non-ipod-usb-disk` — generic non-Apple USB drive (e.g. SanDisk Cruzer Blade `0x0781:0x5567`). Synthesised. Tests that the discovery pipeline silently rejects non-Apple devices rather than misclassifying them.
- `malformed-sysinfo` — synthetic persona with a corrupted SysInfoExtended XML payload. Tests the SIE parser error path.

**Workflow:** Synthesised personas follow `documents/persona-capture-playbook.md` §"Synthesised personas (no hardware)" — pure TypeScript, no `raw/` directory needed beyond a `provenance.md` explaining the synthesis recipe. State-variant personas (`corrupt-db`, `populated`, `rockbox`) follow the full hardware-capture playbook.

**Dependency note:** Rejection-case personas (`ipod-shuffle-not-supported`, `non-ipod-usb-disk`, the existing `ipod-touch-5g-unsupported`, and the 5 Sony Walkmans) will all want `expectedReadiness.level: 'unsupported'` once TASK-331 lands. Either land TASK-331 first and create these personas with the new shape from day one, or create them with the current `'unknown'` workaround and sweep them in TASK-331's implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 State variants captured: ipod-video-5g-corrupt-db (deliberately corrupted iTunesDB) and echo-mini-populated (content-loaded), with provenance.md cross-referencing the empty-state siblings already in the registry
- [ ] #2 Firmware variant captured: ipod-classic-rockbox (Rockbox-installed iPod) — coordinate with user before installing
- [ ] #3 Synthesised rejection personas committed: ipod-shuffle-not-supported and non-ipod-usb-disk, each with synthesis recipe in provenance.md
- [ ] #4 Synthetic error-path persona committed: malformed-sysinfo with a deliberately-corrupted SysInfoExtended XML payload, exercising the parser's error path
- [ ] #5 Rejection-case personas (shuffle, non-ipod, plus existing touch 5G + 5 Sony Walkmans) use the canonical ReadinessLevel: 'unsupported' shape once TASK-331 lands
- [ ] #6 documents/test-devices.md updated with each new capture's date and persona ID
- [ ] #7 Each new persona has a provenance.md following the persona-capture-playbook template
- [ ] #8 echo-mini persona gets either sysInfoExtendedXml (if the device answers VPD 0xC0) OR a FAT32 massStorageBackingFile so Tier-3's withPersona({ persona: echo-mini }) does not fail-fast on 'persona not in sidecar'. Capture-state-and-rationale recorded in provenance.md. Removes the TASK-322.06.01 filter need for this persona (the filter stays as a tripwire for future bare personas).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**echo-mini Tier-3 gap (2026-05-14):** Post-Phase-3 reflection surfaced that the current echo-mini persona has both `sysInfoExtendedXml: null` AND `massStorageBackingFile: null`, so the dummy-hcd-daemon rejects it with 'persona not in sidecar' and every test in the echo-mini Tier-3 group fails. Interim safety belt is **TASK-322.06.01** (filter personas without daemon payload at grouping time). The real fix — capturing/synthesising mass-storage data for echo-mini — lives in this task and is added as a new AC.
<!-- SECTION:NOTES:END -->
