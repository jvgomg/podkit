---
id: TASK-479.02
title: 'FamilyID data corrections — impossible entries, one refuses owned hardware'
status: Done
assignee: []
created_date: '2026-08-13 20:48'
updated_date: '2026-08-18 01:20'
labels:
  - identity
  - devices-ipod
  - data-quality
milestone: m-18
dependencies: []
parent_task_id: TASK-479
priority: high
ordinal: 245000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`FAMILY_ID_TO_GENERATION` (`packages/devices-ipod/src/lookups.ts:89-121`) contains 28 entries. Six are hardware-verified. Eleven are structurally impossible. One is actively wrong on hardware the maintainer owns.

FamilyID is **banded by device class**, which the table ignores:

| Band | Observed on real devices | Table assigns into it |
|---|---|---|
| disk-mode click-wheel | 3, 6, 9, 12, 15, 18 | — |
| shuffle | 130, 132, 133 | 10, 11, 20, 22 |
| iOS | 10055 (iPod7,1 touch 6G) | 12, 19, 21, 23, 25, 26, 27 |

An iPod touch has no disk mode and cannot emit a SysInfoExtended at all, so every touch row is unobtainable by construction. `lookups.ts:29` already states libgpod uses FamilyID only to detect iTunes-phone devices at `>= 10000` — the file's own header refutes the table beneath it.

## P0: `12 -> touch_1g` refuses a real nano

FamilyID 12 is **nano_3g**, confirmed four ways: `documents/sysinfo-captures/nano-3g-8gb-black.xml` (serial `5U8280FNYXX`) reports 12; serial suffix `YXX` -> `B261` -> nano_3g; USB PID `0x1262` -> nano_3g annotated "confirmed on real iPod Nano 3G"; and the macOS iPod cache holds two distinct FamilyID-12 nanos.

The second of those, serial `YM803JBW13F`, has suffix `13F` **absent** from `SERIAL_TO_MODEL`. `resolveCapabilities` builds its bag from only `serialNumber` + `familyId` — no USB PID (`packages/podkit-core/src/device/resolve-capabilities.ts:130-134`, `:217-221`) — so that nano falls through to `lookupByFamilyId(12)` -> `touch_1g` -> `access: 'none'` -> non-overridable refusal at `packages/podkit-cli/src/commands/sync.ts:751-782`, with a message claiming a nano in disk mode "uses Apple's proprietary sync protocol".

A wrong entry is strictly worse than a missing one: it suppresses the honest `assertKnownIpodModel` error a miss would raise.

## Blast radius

Fail-closed, not corrupting. No wrong bytes reach the database or artwork — checksums derive from the device's own ModelNumStr inside libgpod, artwork formats come from firmware `ImageSpecifications`, and `IpodGeneration` carries no `dbVersion`. Realistic harm is wrongful refusal plus wrong capability values persisted to the user's TOML via `packages/podkit-cli/src/config/writer.ts:143-152`, which then replay on later syncs.

## Hardware evidence gathered 2026-08-13

From `~/Library/Preferences/com.apple.iPod.plist` (macOS records `Family ID` and `Updater Family ID` as separate keys) plus the live shuffle's SysInfoExtended:

```
shuffle 2G  6V925GZ9436   Family ID 130   Updater 133   (1GB, MinITunesVersion 7.2)
shuffle 3G  4H02918LALD   Family ID 132   Updater 132
shuffle 4G  CC4LXAVUF4T0  Family ID 133   Updater 135
nano 3G     5U8280FNYXX   Family ID 12    Updater 26
nano 3G     YM803JBW13F   Family ID 12    Updater 26
touch 6G    CCQVL27WGGNL  Family ID 10055
```

`133 -> shuffle_4g` is therefore correct, despite no supporting artifact ever existing in the repo.

## Remediation order

1. Delete `12 -> touch_1g` (reachable and wrong today). Do not immediately substitute `12 -> nano_3g` — confirm the classic 6G does not share it; prefer adding `13F` to `SERIAL_TO_MODEL` first, since the serial axis outranks FamilyID.
2. Delete all touch rows (12, 19, 21, 23, 25, 26, 27). Safe: touches are already refused at USB PID and by `access: 'none'`.
3. Correct the shuffle band: add 130 -> shuffle_2g, 132 -> shuffle_3g; keep 133; delete 10, 11, 20, 22. ADR-024:54 marks shuffle_3g `verified: 'inferred'` — it can be promoted to hardware.
4. Demote chronologically impossible entries (4, 5, 7, 8, 24) — they violate the monotonic FireWireGUID/FamilyID ordering the six anchors establish.
5. Carry provenance per entry (`{ generation, evidence: 'hardware' | 'inferred', source }`), mirroring `support.verified` from ADR-024, so interpolation cannot silently recur.
6. Add a band invariant test: `<100` click-wheel, `100-999` shuffle, `>=10000` iOS. Would have caught 11 entries at commit time.

## Blockers to expect

- `packages/devices-ipod/src/lookups.test.ts:675-693` pins five research guesses as contract; `resolve.test.ts:82-85` pins 133 under a title claiming "(hardware-verified)" that was untrue when written and is true now.
- `packages/podkit-core/src/device/sysinfo-extended.test.ts:119,357` hand-writes `FamilyID 13` with invented serial `5U828GFNYXX` and asserts nano_3g. Fabricated fixture predating the real capture; replace with real capture data.
- Folklore to correct: `familyId // e.g. 120 (nano 4G)` in `packages/ipod-firmware/README.md:46`, `src/inquiry/orchestrator.ts:171`, `src/plist/parser.ts:458`, and `familyId: 0x78` in `packages/device-types/README.md:43`. Real nano 4G is 15. The orchestrator example also pairs `productId: '1261'` with the nano 7G GUID.
- `documents/test-devices.md:69` records the nano 3G FamilyID as "unknown — not yet recorded" while the in-repo capture has held 12 since 2026-05-09. `documents/test-devices.md:15` says "User does not own a shuffle" — now false for three shuffles.

## How this happened

Authored wholesale in `d1147e4a` (2026-05-07) with 22 of 27 values guessed and attributed to "libgpod sources". The audit in `9ac1e636` (2026-05-08) found that attribution false — libgpod has no FamilyID table — corrected the comment, changed no numeric value, and added 63 tests that froze the guesses. The contradicting nano 3G capture landed in `c20b7f33` one day later with its inventory row recording the FamilyID as `(TBD)`. The value was never extracted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `12 -> touch_1g` is gone; a FamilyID-12 nano is no longer refused as an iOS device
- [x] #2 The false refusal is reproduced as a test before the fix (serial `YM803JBW13F` + familyId 12 -> `access: none`) — no hardware needed, both inputs are already known
- [x] #3 All touch rows (12, 19, 21, 23, 25, 26, 27) are removed — iOS devices cannot emit a SysInfoExtended, so the values are unobtainable
- [x] #4 Shuffle band corrected from hardware: 130 -> shuffle_2g and 132 -> shuffle_3g added, 133 kept, 10/11/20/22 removed
- [x] #5 The fabricated FamilyID 13 fixture in `sysinfo-extended.test.ts:119,357` is replaced with real capture data
- [x] #6 `documents/test-devices.md` FamilyID rows and the `120`/`0x78` folklore sites are corrected
- [x] #7 ADR-024's shuffle_3g `verified: 'inferred'` is promoted to hardware
- [x] #8 Changeset accompanies the data corrections
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope narrowed 2026-08-13: this task now covers only the data corrections that have hardware behind them and can ship immediately. The provenance restructure, band invariant test, chronological demotions and test-contract renegotiation moved to TASK-479.06 so they do not delay the fix.

The pink shuffle 2g SysInfoExtended is already captured at `documents/sysinfo-captures/shuffle-2g-1gb-pink.xml` — the repo's first shuffle capture. No further capture session is needed: personas and `documents/sysinfo-captures/` already cover FamilyIDs 3, 6, 9, 12, 15, 18 twice over, and the shuffle 3g/4g band evidence (132/133) is established from the macOS iPod cache.

Data corrections landed 2026-08-13.

**FamilyID table** (`packages/devices-ipod/src/lookups.ts`)
- `12` remapped `touch_1g` → `nano_3g`, with the four-axis evidence and the open classic-6G risk recorded in a code comment.
- Deleted every touch row: 12 (remapped), 19, 21, 23, 25, 26, 27.
- Shuffle band: added `130 → shuffle_2g` and `132 → shuffle_3g`, kept `133 → shuffle_4g`, deleted `10`, `11`, `20`, `22`. Note `10 → shuffle_1g` went with them — shuffle_1g now has no FamilyID entry, because the 130-band value for it has never been read.
- Header rewritten: band table (<100 / 100-999 / >=10000), per-entry source serials, explicit `Family ID` vs `Updater Family ID` warning, and an explanation of why no iOS row can ever be obtained.
- `13 → nano_3g` deliberately kept but flagged suspect in-comment: it is the research guess that 12 displaced, and demoting research entries is TASK-479.06's scope.

**Serial table** — `13F` was NOT added. The suffix determines capacity and colour as well as generation, and nothing in-repo (or in libgpod) ties `13F` to a nano 3G model number; the macOS iPod cache carries no model number. Guessing one of the six existing nano_3g rows would have fabricated a variant, which is the failure mode this task exists to remove. A comment in `tables/serials.ts` records the gap and the device's serial. The FamilyID remap alone clears the refusal, so AC #1 does not depend on it.

**Reproduction before fix** — two tests, both red before the table change:
- `packages/devices-ipod/src/resolve.test.ts` — `{ serialNumber: 'YM803JBW13F', familyId: 12 }` resolved to `touch_1g`; now `nano_3g` with no `unsupportedReason` and `access: 'syncable'`.
- `packages/podkit-core/src/device/resolve-capabilities.test.ts` — same bag through the resolver that production builds (serial + familyId only, no USB PID).

**Test contract changes**
- `resolve.test.ts`: touch `kind=ios-device` discriminator test moved from the FamilyID axis (`familyId: 27`) to the libgpod axis (`libgpodGeneration: 'touch_2'`) — same assertions, an axis that still exists.
- `lookups.test.ts`: added hardware pins for 12/130/132/133; added a negative test for 10/11/20/22; the 0-29 sweeps now iterate the whole table and a new sweep asserts no entry resolves to any `touch_*` generation.
- `support.test.ts`: shuffle_3g re-pinned `read-only, hardware`.

**Provenance promotion** — shuffle_3g `verified: 'inferred'` → `'hardware'` in `tables/generations.ts`, ADR-024 §2, and the generated matrix in `documents/formats/generations.md`. Caveat for the record: the hardware evidence is a device reading (serial 4H02918LALD, FamilyID 132, serial suffix ALD → C384), not an end-to-end exercise of the read path.

**Fabricated fixture replaced** — `sysinfo-extended.test.ts` now uses the real nano 3G capture's identifiers (GUID `000A27001BC8EED6`, serial `5U8280FNYXX`, FamilyID 12, UpdaterFamilyID 26, VisibleBuildID 1.1.3) and PID `1262`. `ModelNumber B261` is retained with a comment saying no in-repo capture carries that key — it is kept only to exercise the ModelNumStr axis, with the value that device's serial suffix resolves to.

**Docs** — `documents/test-devices.md`: nano 3G FamilyID recorded as 12 plus model/serial, second FamilyID-12 nano noted, new iPod shuffle 2G/3G/4G inventory section carrying the band evidence and the Family-vs-Updater warning, shuffle-ownership claim corrected. Same claim corrected in `documents/persona-capture-playbook.md` (which also wrongly said shuffles do not expose SIE and called `0x1300` a shuffle 4G). FamilyID folklore fixed in `packages/ipod-firmware/README.md`, `inquiry/orchestrator.ts`, `plist/parser.ts`, `packages/device-types/README.md` and `devices-ipod/src/resolve.ts` — all now use the nano 4G (PID `0x1263`, serial `5U851AEH3R0`, GUID `000A27001DCECFB5`, FamilyID 15) coherently.

Changeset: `.changeset/family-id-hardware-corrections.md` (patch: `@podkit/devices-ipod`, `@podkit/core`, `podkit`).

Gates green: `bun run lint`, `bun run typecheck`, `test:unit --filter @podkit/devices-ipod` (389 pass), `test:unit --filter @podkit/core` (3412 pass).

Extended 2026-08-17/18 from a hardware session with eight iPods. FamilyID 17 was `classic_7g` (research) and is really `nano_6g`, read from firmware on a connected 16GB nano 6G (serial DCYGLUGVDDW4). That guess pointed the dangerous way: classic_7g is syncable and nano_6g is not, so a nano 6G with an unmapped serial suffix would have been treated as writable. The Classic 7G's FamilyID is now honestly unknown rather than guessed.

Serial-suffix mappings added from hardware: `0GQ -> D478` (nano 7G 16GB Green, serial DCYN83SFF0GQ) and `0GM -> D475` (nano 7G 16GB Pink, serial C7RJR3TLF0GM). Pink records its residual ambiguity in the comment — Apple shipped a 16GB Pink nano 7G in both 2012 (D475) and 2015 (KMV2), and nothing on the device distinguishes them; the two attested neighbours 0GP/0GQ place this suffix block in the 2012 run. Green had no such ambiguity: the 2015 refresh had no green.

Colour naming corrected: the dark nano 6G is Graphite, not Black (that is the 3G/4G-era name) and not Space Gray (which arrives with the 7G in 2013). Confirmed against the physical unit. `@podkit/ipod-db`'s model table still says Black and was deliberately left alone — it is a faithful port of libgpod's `ipod_info_table` and uses libgpod's own `nano_black` naming; the divergence is documented where the two meet.

FamilyID anchors re-confirmed on hardware: 18 on four separate nano 7G units, 15 on a second nano 4G, 12 on the physical nano 3G the in-repo capture came from, 9 on a second nano 2G.
<!-- SECTION:NOTES:END -->
