---
id: TASK-324
title: 'Phase 5: persona registry expansion'
status: Done
assignee: []
created_date: '2026-05-11 22:56'
updated_date: '2026-05-23 16:05'
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
- [x] #1 State variants captured: ipod-video-5g-corrupt-db (deliberately corrupted iTunesDB) and echo-mini-populated (content-loaded), with provenance.md cross-referencing the empty-state siblings already in the registry
- [ ] #2 Firmware variant captured: ipod-classic-rockbox (Rockbox-installed iPod) — coordinate with user before installing
- [x] #3 Synthesised rejection personas committed: ipod-shuffle-not-supported and non-ipod-usb-disk, each with synthesis recipe in provenance.md
- [x] #4 Synthetic error-path persona committed: malformed-sysinfo with a deliberately-corrupted SysInfoExtended XML payload, exercising the parser's error path
- [x] #5 Rejection-case personas (shuffle, non-ipod, plus existing touch 5G + 5 Sony Walkmans) use the canonical ReadinessLevel: 'unsupported' shape once TASK-331 lands
- [x] #6 documents/test-devices.md updated with each new capture's date and persona ID
- [x] #7 Each new persona has a provenance.md following the persona-capture-playbook template
- [ ] #8 echo-mini persona gets either sysInfoExtendedXml (if the device answers VPD 0xC0) OR a FAT32 massStorageBackingFile so Tier-3's withPersona({ persona: echo-mini }) does not fail-fast on 'persona not in sidecar'. Capture-state-and-rationale recorded in provenance.md. Removes the TASK-322.06.01 filter need for this persona (the filter stays as a tripwire for future bare personas).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**2026-05-17 — TASK-324 paused pending SCSI synthesis foundation work.**

While preparing to land the AFK remnants (synthesised corrupt-db, echo-mini-populated, AC #5 readiness sweep, AC #6 docs, AC #7 provenance, AC #8 echo-mini sidecar), the Tier-3 baseline was confirmed broken (4 fails in `personas-baseline.tier3.test.ts`). Root-cause investigation surfaced that:

1. CLI flag drift: `personas-baseline.tier3.test.ts` uses `device scan --format json` but the flag was removed in TASK-316. Correct: `--json`.
2. SCSI synthesis gap: `/dev/sg*` never appears in the test VM because (a) `sg` kernel module not loaded, (b) iPod personas have `massStorageBackingFile: null`. The dummy-hcd daemon (`tools/device-testing/dummy-hcd/src/gadget.ts`) already supports `bindFfs && bindMassStorage` composition — what's missing is just the kernel module + persona backing files.

The user chose **Path A** (close the gap rather than redefine `healthy` to expect a warn). Foundation work split out as two new high-priority m-19 tasks:

- **TASK-A1** (`Test VM: load sg kernel module + verify daemon mass-storage gadget path`) — infrastructure layer
- **TASK-A2** (`Synthesize FAT32 mass-storage backing for iPod starter personas`) — migrates the 3 starter personas; AC #8 of THIS task (echo-mini sidecar fix) is folded into TASK-A2 since the approach is identical

Once TASK-A1 + TASK-A2 land, this task resumes. Remaining scope:

- AC #1 part A: `ipod-video-5g-corrupt-db` — synthesised (no hardware capture needed per user direction 2026-05-17). Take real iPod 5G iTunesDB raw (if available) + truncate, OR synthesize a minimal 512-byte `mhbd`-header file with scrambled checksum.
- AC #1 part B: `echo-mini-populated` — synthesised. Builds on TASK-A2's FAT32 image work but with seeded content (handful of mocked MP3-named files in the FAT32).
- AC #2: Rockbox — split out as new task (see Rockbox deferral task) — HITL, multi-hour.
- AC #5: sweep readiness shape — TASK-331 is Done, sweep the existing rejection personas (shuffle, non-ipod, touch 5G, 5 Sony Walkmans) to the canonical `'unsupported'` ReadinessLevel.
- AC #6: update `documents/test-devices.md` with synthesised persona entries (existing + new).
- AC #7: provenance.md for new synthesised personas.
- AC #8: **superseded by TASK-A2** — echo-mini sidecar fix lands there with the FAT32-backing approach.

**2026-05-18 — AC #8 confirmed satisfied by TASK-348.**

TASK-348 landed (`backlog/tasks/task-348 - Synthesize-FAT32-mass-storage-backing-for-iPod-starter-personas.md`). All 3 starter personas — including `echo-mini` — now have a `massStorageBackingFile.synthesis` recipe; the runner's `prepare()` builds the FAT32 image deterministically in-VM via `mkfs.vfat --invariant`. The TASK-322.06.01 echo-mini filter no longer triggers (`tier3-runtime-setup.test.ts` canary flipped to assert inclusion), and the Tier-3 baseline is GREEN (39 pass / 0 fail).

AC #8 is left unchecked here per the team-lead's note ("don't tick it yet — TASK-324 stays To Do, the AC just becomes superseded"). The work itself is done; TASK-324's remaining ACs (#1, #2, #5, #6, #7) are independent.

**2026-05-23 — ACs #1, #5, #6, #7 landed (TASK-324 complete except AC #2 deferred).**

AC #1 — two state-variant personas synthesised:
- `ipod-video-5g-corrupt-db`: same USB identity + SIE XML as `ipod-video-5g-iflash-1tb`; `massStorageBackingFile.synthesis.initialContent` seeds a 512-byte truncated iTunesDB (`mhbd` magic + zeros, `headerLen = 0`). `parseDatabase` throws 'mhbd header too small'. `corruptItunesDb: Uint8Array` exported from persona module for Tier-1 direct-call smoke test. Tier-1 test asserts `parseDatabase` throws. `expectedReadiness.level: 'needs-repair'`, `stage: 'database'`.
- `echo-mini-populated`: same USB identity/preset/probes as `echo-mini`; `synthesis` recipe seeds 5 × 64-byte `0xAA` sentinel `.mp3` blobs in `Music/` via `initialContent`. Different FAT label (`ECHO_POPU` vs `ECHO_MINI`) keeps images distinguishable in VM. `expectedReadiness.level: 'ready'`.

AC #5 — readiness sweep: `sony-nw-a1000`, `sony-nw-a1200`, `sony-nw-a3000`, `sony-nw-hd5` all updated from `level: 'unknown'` to canonical `level: 'unsupported'` with top-level `unsupported` payload. Added `describe.each` block in `rejection-personas.test.ts` asserting all 4 personas pass the TASK-331 shape invariants.

AC #6 — `documents/test-devices.md` updated: added `ipod-video-5g-corrupt-db` and `echo-mini-populated` to the synthesised personas table (dated 2026-05-23); updated last-updated header.

AC #7 — `provenance.md` written for both new personas following the synthesised-persona template.

AC #2 (Rockbox HITL) deferred to TASK-347 — remains unchecked.
AC #8 (echo-mini sidecar) — confirmed satisfied by TASK-348; left unchecked per prior note.

Quality gates: `typecheck` green, `build` green, `test` 328 pass / 0 fail.

New dependency added: `@podkit/ipod-db` as devDependency of `@podkit/device-testing` (needed for `parseDatabase` call in `corrupt-db.test.ts` Tier-1 smoke test).
<!-- SECTION:NOTES:END -->
