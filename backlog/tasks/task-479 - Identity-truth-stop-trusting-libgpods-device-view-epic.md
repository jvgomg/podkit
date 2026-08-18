---
id: TASK-479
title: 'Identity truth: stop trusting libgpod''s device view (epic)'
status: Done
assignee: []
created_date: '2026-08-13 20:47'
updated_date: '2026-08-18 01:20'
labels:
  - identity
  - shuffle
  - data-integrity
milestone: m-18
dependencies: []
priority: high
ordinal: 243000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

An iPod shuffle 2nd gen (1GB, pink, serial `6V925GZ9436`, USB PID `0x1301`, FamilyID 130) was set up and synced on 2026-08-13. Sync reported "Synced 198 items successfully" and `doctor` reported all checks passed. The device could not play any of it — the firmware flashed an error.

Root cause: **libgpod cannot identify this device, and podkit delegates decisions to it anyway.**

libgpod resolves generation from (a) its own serial-suffix table and (b) classic SysInfo `ModelNumStr`. This device has no classic SysInfo (`ModelNumStr` is not a SysInfoExtended key on any iPod — 0 of 8 in-repo captures carry it), and its serial suffix `436` is in neither libgpod's table nor ours. libgpod has **no USB-PID axis at all**. So `getInfo().device.generation === 'unknown'`, while podkit's own cascade correctly resolves `shuffle_2g` from the USB PID.

Three distinct defects fall out of that single blindness, in severity order — one per sub-task.

## Evidence

Reproduced with the device continuously mounted (no replug, no Music.app involvement):

```
before:  iTunesDB 3532 B (21:37:32)   iTunesSD 18 B (21:37:34)
podkit sync -c test --quality low  →  "Synced 3 items successfully"
after:   iTunesDB 9704 B (21:42:52)   iTunesSD 18 B (21:37:34)  ← never written
```

`itdb_write()` writes the shuffle database only under `if (itdb_device_is_shuffle (itdb->device))` (`tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_itunesdb.c:6142`), and `itdb_device_is_shuffle()` returns FALSE for `ITDB_IPOD_GENERATION_UNKNOWN` (`itdb_device.c:2210-2244`). `packages/libgpod-node/native/database_wrapper.cc:227` calls `itdb_write()` and nothing else.

## Separate, non-podkit finding (context only)

The 198 tracks were later deleted by macOS `AMPDevicesAgent` on replug (empty `F00/F01/F02` dirs stamped 21:37:32, Apple's own empty iTunesDB + 18-byte iTunesSD + `iTunesPrefs.plist` with empty `MusicTrackIDs` written 21:37:32-34; auto-sync prevention was unset). Not a podkit bug, but it masked the real one — the device looked wiped rather than unplayable. Worth a docs note under troubleshooting.

## Sub-tasks

1. Shuffle `iTunesSD` write support — sync claims success, device unplayable (data integrity)
2. FamilyID table integrity — entries structurally impossible; one actively refuses owned hardware
3. `device info` renders libgpod identity — self-contradictory output
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All sub-tasks are Done (479.01-.06)
- [x] #2 No production code path treats libgpod's `getInfo().device` as identity truth; it is a cascade input only
- [x] #3 Where libgpod needs identity to behave correctly, podkit supplies it through libgpod's documented API using hardware-attested data — never fabricated
- [x] #4 A syncable iPod that libgpod cannot identify (shuffle 2g) syncs to a playable state and reports honestly
- [x] #5 Regression coverage exists for the syncable-but-libgpod-unknown case, which no test previously exercised
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design settled 2026-08-13 after a grilling session. Resolved decisions, superseding anything narrower in the sub-task bodies:

1. Keep libgpod. It supports shuffles fully — `itdb_write` calls `itdb_shuffle_write` itself and handles both DB formats. The defect is identity resolution, not a missing feature. No libgpod patch, no new native binding, no TypeScript iTunesSD writer (which would also jump m-8's declared read-before-write sequencing and require a `BufferWriter` that does not exist).

2. Fix identity through libgpod's documented API — the already-bound `database.setSysInfo('ModelNumStr', ...)` — using a model number the cascade resolved from the device, grounded by adding the hardware-attested serial suffix `436 -> A947`. Nothing fabricated.

3. Identity writes happen only in explicit write-intent paths (`device add`, `doctor --repair`), per conventions.md:257-260. Sync gains no new side effect.

4. No general 'sync must verify device-class artifacts' invariant — the answer to this class of bug is better device support, not a verification layer. The empty-iTunesSD check survives as a doctor *diagnostic* only.

5. Interim: refuse shuffle sync until 479.01 lands (479.04), expressed as a typed error, NOT by changing the access tier.

6. No hardware capture session needed — in-repo captures and personas already cover FamilyIDs 3/6/9/12/15/18 twice over, and the shuffle band is established from the macOS iPod cache. Only end-to-end verification on the pink shuffle 2g is required.

Sub-tasks: .01 shuffle identity/iTunesSD | .02 FamilyID data corrections | .03 device info identity | .04 interim shuffle refusal | .05 MA147 fabrication on init/reset/add | .06 FamilyID provenance restructure. Related: DRAFT-022 (macOS Music.app auto-sync wipe).

Hardware session 2026-08-17/18 across eight iPods (shuffle 2G, nano 7G x4, nano 6G, nano 4G, nano 3G, nano 2G) closed every acceptance criterion and grew the epic by three sub-tasks that only hardware could have surfaced: .08 nano 7G tier, .09 doctor on read-only devices, .10 archive identity honesty. Two further research FamilyIDs were overturned by firmware readings, one of which (17) would have made a nano 6G look writable.
<!-- SECTION:NOTES:END -->
