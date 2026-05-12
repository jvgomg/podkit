---
id: TASK-324
title: 'Phase 5: persona registry expansion'
status: To Do
assignee: []
created_date: '2026-05-11 22:56'
updated_date: '2026-05-12 11:59'
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
Rolling parent task for expanding the persona registry beyond the 3 starter personas captured in Phase 1.

**Hardware inventory**: `documents/test-devices.md` is the canonical list of physical devices available for capture, with USB Product IDs, Apple serials, and capture-status notes per device. Update that doc as new personas are captured.

Target personas (positive) — all confirmed in user's inventory unless noted:
- `ipod-video-5g-fresh` (5G Video, iFlash 1TB mod) — SCSI-fallback generation; XML capture exists
- `ipod-video-5g-corrupt-db` (5G Video, deliberately corrupted iTunesDB) — repair-path test
- `ipod-nano-7g` (nano 7G 16GB) — USB-inquiry generation; XML capture exists; user has 2 (regular + Blue)
- `ipod-nano-4g` (nano 4G 8GB Black) — additional generation coverage
- `ipod-nano-3g` (nano 3G 8GB Black) — additional generation coverage
- `ipod-nano-2g` (nano 2G 4GB Green) — captures the "post-2006 SysInfo 0-byte" edge case
- `ipod-mini-2g` (mini 2G 4GB Pink) — SCSI-fallback generation
- `ipod-classic-rockbox` (nano or other with Rockbox layout) — requires Rockbox install on existing hardware; firmware-variant capability synthesis
- `echo-mini-populated` (Echo Mini DAP with content) — paired with starter `echo-mini-empty`

Target personas (negative — should be rejected by classifier):
- `ipod-touch-not-supported` (iPod touch 5G iOS) — in inventory; expected rejection
- `ipod-shuffle-not-supported` (Shuffle) — NOT in user's inventory; needs procurement OR synthesised persona
- `non-ipod-usb-disk` (random USB mass storage) — synthesised; must not be misclassified as iPod
- `malformed-sysinfo` (synthetic — corrupted SysInfoExtended XML) — parser error path

Each persona = one subtask. They're independent and can be picked up in any order.

Use the capture scripts established in TASK-321.02 for consistency. Each captured persona must update `documents/test-devices.md` with capture date + persona ID.

**Human-in-the-loop capture flow** (same as TASK-321.02):
1. User plugs device into mac.
2. Agent runs `bun run device-testing:capture --persona <id>`.
3. For Linux-side `lsblk` capture, device passed through to Lima VM via USB passthrough OR captured separately on a Linux machine.
4. Agent commits captured data + provenance.md + updates documents/test-devices.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 At least 6 additional positive personas captured (full set above is ideal); each cross-references documents/test-devices.md
- [ ] #2 All 4 negative personas captured + tests asserting correct rejection behaviour
- [ ] #3 Each persona has provenance.md
- [ ] #4 Tier 1 unit tests cover each persona's expected capabilities / readiness / doctor output
- [ ] #5 Tier 3 integration tests cover at least 1 positive + 1 negative persona end-to-end via the FunctionFS daemon
- [ ] #6 documents/test-devices.md updated as each persona is captured (capture date + persona ID linked back to fixture path)
<!-- AC:END -->
