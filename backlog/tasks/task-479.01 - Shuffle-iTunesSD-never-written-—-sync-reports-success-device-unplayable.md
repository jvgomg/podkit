---
id: TASK-479.01
title: 'Shuffle iTunesSD never written — fix libgpod''s identity, not the write path'
status: Done
assignee: []
created_date: '2026-08-13 20:47'
updated_date: '2026-08-18 01:20'
labels:
  - shuffle
  - data-integrity
  - libgpod-node
milestone: m-18
dependencies: []
parent_task_id: TASK-479
priority: high
ordinal: 244000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

An iPod shuffle plays from `iPod_Control/iTunes/iTunesSD`. `iTunesDB` is inert on it. podkit writes only `iTunesDB`, so a synced shuffle has audio files on disk and no index to play them from. Sync reports success; `doctor` reports all checks passed; the device errors on playback.

Reproduced on a shuffle 2g with the device continuously mounted (rules out replug, macOS, and hardware fault):

```
before:  iTunesDB 3532 B   iTunesSD 18 B (Apple's empty stub, older mtime)
podkit sync -c test --quality low  ->  "Synced 3 items successfully"
after:   iTunesDB 9704 B   iTunesSD 18 B (mtime unchanged)
```

## Root cause: identity, not a missing feature

**libgpod supports shuffles completely.** `itdb_write` calls `itdb_shuffle_write` on its own, and that writer handles both the 1g/2g flat format and the 3g/4g `bdhs` format. Nothing is missing in libgpod's write path.

What fails is libgpod's *model resolution*, which two decisions key off:

1. `tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_itunesdb.c:6137-6143` — `if (itdb_device_is_shuffle(device))` decides whether iTunesSD is written at all. `itdb_device.c:2210-2244` returns FALSE for `ITDB_IPOD_GENERATION_UNKNOWN`.
2. `itdb_itunesdb.c:6871-6874` — `is_shuffle_2g()` -> `itdb_device_get_shadowdb_version()` decides *which format*. `itdb_device.c:2304-2360` maps UNKNOWN to `ITDB_SHADOW_DB_UNKNOWN`, not V1, so even a forced call would write the 3g/4g format onto a 2g and return TRUE.

libgpod resolves the model from its serial-suffix table, then classic SysInfo `ModelNumStr` (`itdb_device.c:1207-1237`). It has **no USB-PID axis**. This device has no classic SysInfo, and its serial suffix `436` is in neither libgpod's table nor ours — so it resolves to UNKNOWN while podkit's own cascade correctly says `shuffle_2g` from USB PID `0x1301`.

## Approach: give libgpod the identity through its documented API

No libgpod patch. No new native binding. The binding already exists — `database.setSysInfo` (`packages/libgpod-node/native/database_wrapper.cc:64`, `:381`, `:413`; TS at `packages/libgpod-node/src/database.ts:1796`), with persistence proven by `packages/libgpod-node/src/__tests__/database.integration.test.ts:293-311`. It is currently called **zero** times from `podkit-core` and `podkit-cli`.

Setting `ModelNumStr` flips `itdb_device_get_ipod_info()` to `SHUFFLE_2`, which corrects `is_shuffle`, `shadowdb_version` (-> V1), `musicdirs` (3 rather than 20), and every other generation-keyed libgpod path at once.

### Ground the model number in evidence, do not infer it

The device's serial is `6V925GZ9436` -> suffix `436`, absent from `SERIAL_TO_MODEL`. Its SysInfoExtended reports `NumMBytes 1024` (1GB) and the unit is pink, which is `A947` exactly (`packages/devices-ipod/src/tables/model-numbers.ts:222`). Existing pink-1GB suffixes are `XQ5`/`XQS` (`packages/devices-ipod/src/tables/serials.ts:115-116`).

Add `'436': 'A947'` as a hardware-attested mapping with the serial recorded. Then the cascade yields a real model number and nothing is fabricated. This is the same shape of fix as TASK-479.02: the tables were incomplete, the code was not wrong.

### Write it in the repair path only

Set `ModelNumStr` during explicit write-intent paths (`device add`, `doctor --repair`), not during sync. `documents/architecture/conventions.md:257-260` already establishes the repair path as the only writer. A device repaired once then syncs correctly forever, because libgpod reads SysInfo at parse time — and sync gains no new side effect.

This generalises: any libgpod-blind iPod that podkit's cascade *can* identify gets corrected the same way, not just shuffles.

## Not required

`iTunesStats`, `iTunesPState` and `iTunesPrefs` are **not** needed for playback. libgpod writes none of them (zero source hits for the latter two); it treats `iTunesStats` as device-generated, reading it for playcounts then deleting it so the firmware regenerates it (`itdb_itunesdb.c:7113-7126`). Checksums are also a non-issue — shuffle 2g requires none (`itdb_device.c:1958-1979`).

## Doctor diagnostic

A shuffle with tracks in `iTunesDB` and an empty `iTunesSD` should be a doctor finding. Framed as a *diagnostic*, not a sync gate — it turns "music vanished and the LEDs flashed" into one line of output.

## Doc corrections that fall out

`documents/formats/itunessd-bdhs.md:18` and `documents/formats/generations.md:75-76` claim the iTunesSD playback DB "needs iTunes authentication libgpod cannot produce". `itdb_shuffle_write_file` writes a plain buffer via `g_file_set_contents` with no signing, checksum or hash step. The claim is not grounded in the source.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `'436': 'A947'` is added to `SERIAL_TO_MODEL`, marked hardware-attested with the source serial recorded
- [x] #2 `ModelNumStr` is set on the libgpod device via the existing `setSysInfo` binding when the cascade resolves a model that libgpod cannot
- [x] #3 The write happens in explicit write-intent paths (`device add` / `doctor --repair`), never as a side effect of sync
- [x] #4 Syncing to the repaired shuffle writes a populated `iTunesSD` in the V1 (1g/2g) format — verified by inspecting the bytes, not by trusting the return value
- [x] #5 No libgpod patch and no new native binding are introduced
- [x] #6 A shuffle with tracks in `iTunesDB` and an empty `iTunesSD` is surfaced as a doctor diagnostic
- [x] #7 Hardware verification on the pink shuffle 2g: repair, sync, replug, tracks play
- [x] #8 Regression test covers an iPod whose libgpod generation is `unknown` but whose cascade model resolves
- [x] #9 The unfounded 'needs iTunes authentication' claims in `documents/formats/itunessd-bdhs.md:18` and `generations.md:75-76` are corrected
- [x] #10 Remove the interim shuffle-sync refusal in packages/podkit-cli/src/commands/sync.ts (SyncErrorCodes.SHUFFLE_ITUNESSD_UNSUPPORTED gate, plus its sync-runner.unit.test.ts coverage) once iTunesSD write support lands
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (not committed) in worktree .claude/worktrees/task-479-identity.

**Verified against libgpod source first.** `itdb_device_get_ipod_info` tries `itdb_ipod_info_from_serial` (returns NULL on miss, so the fall-through to `ModelNumStr` is real), then `get_ipod_info_from_model_number`, which strips ONE leading alpha before its table lookup — so the value written must be the M-prefixed form (`MA947`), not the bare `A947`. The device's SysInfoExtended carries `ShadowDB` (bool), not the `ShadowDBVersion` int libgpod reads, so `itdb_device_get_shadowdb_version` genuinely falls through to the generation switch. Both defect sites confirmed.

**Serial mapping.** `'436': 'A947'` added to `SERIAL_TO_MODEL` with the source serial `6V925GZ9436`, FamilyID 130 and `NumMBytes 1024` recorded in the comment. Regression test in `resolve.test.ts` pins the full variant (shuffle_2g / A947 / 1GB / Pink / source 'serial').

**Where setSysInfo is hooked, and why there.** `IpodDatabase` in podkit-core had no `setSysInfo`/`getSysInfo` passthrough (the binding existed only on libgpod-node's `Database`, which is private inside the wrapper), so a thin pair was added there first. Two call sites:

1. `doctor --repair sysinfo-modelnum-missing` — new check + repair. The general answer: works on any already-initialised device, needs no re-add, and lands in the path conventions.md nominates as the only writer. Declares `requirements: ['writable-device', 'database']` so the CLI opens the DB, then calls `setSysInfo` + `save()` itself (the framework never saves for a repair).
2. `device add`, after the final add confirmation, for a device that already has an iTunesDB. Placed after the confirm deliberately — everything before it is still cancellable. Best-effort: a failure there does not fail the add, because doctor reports the same condition.

The *initialisation* path is handled differently: `initializeIpod` already accepts a model and libgpod writes SysInfo itself, so `device add`'s init branch passes the resolved model rather than calling setSysInfo afterwards. Same for `device init` / `device reset` (see TASK-479.05).

**How 'libgpod's view is unknown' is decided.** `db.device.generation === 'unknown'`, read through a defensive accessor (`checks/database-device-view.ts`) because the real getter throws on a closed handle. That string is the single sink for both libgpod outcomes: no `ModelNumStr` at all yields `ipod_info_table[0]`, an unrecognised one yields `ipod_info_table[1]`, and both carry `ITDB_IPOD_GENERATION_UNKNOWN` → `GenerationToString` → `'unknown'`. It is also what the wrapper substitutes when there is no device record. `device-validation.ts` already treats it as the canonical unknown check.

**Never fabricated.** The written value comes only from `resolveFirmwareTruth` — SysInfoExtended serial → serial-suffix lookup, else the live-USB model. A USB-derived model carries no `modelNumber`, so it can identify but never name; the repair refuses in that case, and refuses again when there is no firmware truth at all. Both refusals are asserted.

**Doctor diagnostic (AC#6).** New `shuffle-playback-db` check: shuffle + tracks in iTunesDB + iTunesSD absent or <= 18 bytes → warn, `repairable: false`. 18 bytes is the exact 1g/2g header size (records are 558 bytes each) and also Apple's empty stub, so the threshold holds for either format. It decides 'is a shuffle' from firmware truth first, because the database layer's own generation is unreliable by construction in exactly the case the check exists for.

**Shared extraction.** `resolveFirmwareTruth` moved out of `sysinfo-modelnum-mismatch.ts` into `checks/firmware-truth.ts` (three consumers now), and its inline `M${...}` re-prefixing replaced by a new exported `toModelNumStr` in `@podkit/devices-ipod`.

**Interim refusal removed (AC#10).** `SHUFFLE_ITUNESSD_UNSUPPORTED` deleted from `sync.ts` and its error-code enum; the three tests that pinned it replaced by one asserting a syncable shuffle_2g now falls through to the next gate; `.changeset/shuffle-sync-refusal.md` deleted. The read-only shuffle_4g test is kept and still pins `DEVICE_UNSUPPORTED`.

**Doc corrections (AC#9).** Both 'needs iTunes authentication' claims corrected against the source: `itdb_shuffle_write_file` assembles a plain buffer and commits it with `g_file_set_contents` — no signing, hashing or checksum anywhere in the shuffle write path, and `itdb_device_get_checksum_type` returns `ITDB_CHECKSUM_NONE` for all four shuffle generations. `generations.md` is generated, so the fix went into the `note` fields on shuffle_3g/4g in `generations.ts` and the doc block was regenerated (drift test green). The 3g/4g tier stays `read-only`, now on the honest ground that the bdhs write is unverified on hardware.

**Judgment calls.**
- The same unfounded 'iTunes authentication' claim also lives in `packages/devices-ipod/src/tables/unsupported.ts` (`SHUFFLE_REASON`, the user-facing refusal copy for shuffle 3g/4g PIDs), `tables/libgpod-mapping.ts:194`, and `podkit-core/src/ipod/device-validation.ts:118`. Left alone — rewriting user-facing refusal copy for a different generation band is a separate behavioural surface, and those tables are being edited by sibling work. Worth a follow-up.
- Check named `sysinfo-modelnum-missing` to pair with the existing `sysinfo-modelnum-mismatch` (missing = no usable value; mismatch = wrong value). User-facing strings say 'the database layer', never 'libgpod', matching the existing convention pinned by the nano-7g sync test.
- The repair backs up an existing classic SysInfo to `SysInfo.podkit-backup` before saving, because libgpod rewrites that whole file from its in-memory table and would drop any key it did not parse. Same convention as the sibling repair.
- `device add`'s correction is best-effort and does not fail the add; doctor reports the identical condition, so a hard failure there would only block onboarding for something already surfaced elsewhere.

**Not verified.** AC#4 and AC#7 need the hardware. The pink shuffle 2g was unplugged; no device operations were attempted.

**Gates.** lint clean; typecheck 36/36; `bun run build --filter @podkit/libgpod-node` ok; `@podkit/devices-ipod` 390 pass / 0 fail; `@podkit/core` 3439 pass / 0 fail; `podkit` 1971 pass / 0 fail. (`@podkit/ipod-web` fails on a missing generated ipod-db fixture in this worktree — pre-existing and unrelated; no file in either package was touched.)

**Files changed.** `packages/devices-ipod/src/tables/serials.ts`, `tables/generations.ts`, `src/lookups.ts` (+`toModelNumStr`), `src/index.ts`, `src/resolve.test.ts`; `packages/podkit-core/src/ipod/database.ts` (+`getSysInfo`/`setSysInfo`), `src/diagnostics/index.ts`, `src/diagnostics/repair-dispatch.ts` (+`.test.ts`), `src/diagnostics/checks/firmware-truth.ts` (new), `checks/database-device-view.ts` (new), `checks/sysinfo-modelnum-missing.ts` + `.test.ts` (new), `checks/shuffle-playback-db.ts` + `.test.ts` (new), `checks/sysinfo-modelnum-mismatch.ts`, `checks/scope-matrix.test.ts`; `packages/podkit-cli/src/commands/device/add.ts`, `commands/doctor.ts` + `doctor.test.ts`, `commands/sync.ts`, `commands/sync-runner.unit.test.ts`; `documents/formats/itunessd-bdhs.md`, `documents/formats/generations.md`, `docs/user-guide/devices/doctor.md`, `docs/reference/cli-commands.md`; `.changeset/shuffle-playback-database.md` (new), `.changeset/shuffle-sync-refusal.md` (deleted).

**Post-implementation review (sonnet, over the full diff) — four should-fix items, all addressed.**

1. *`device add`'s identity paths had zero coverage.* Confirmed empirically by the reviewer: all 50 existing `device-add.unit.test.ts` tests passed unchanged against the diff, so neither the `initializeIpod` model pass-through nor `teachDatabaseItsIdentity` was exercised. Added a `runDeviceAdd: SysInfo model number` block (6 tests, file now 56): fresh database bakes in `MA947` / passes nothing for a USB-only model; existing database writes `ModelNumStr` only when the database layer says `unknown` AND the cascade carries a model number, writes nothing in both negative cases, and closes both handles it opens.

2. *Real landmine: `shuffle-playback-db.ts` read `ctx.db?.trackCount` directly* while using the defensive accessor for `device`. `IpodDatabase.trackCount` calls `assertOpen()` and throws `DATABASE_CLOSED`, and `diagnostics/index.ts` runs `check.check(ctx)` with no per-check try/catch — so a closed handle would have crashed the whole doctor run instead of skipping one check. Fixed by adding `readDatabaseTrackCount` alongside `readDatabaseDeviceView` (both now share one `readGetter` helper) and pinned with a test whose fake handle has getters that actually throw — the plain-object fakes could not express that case.

3. *`teachDatabaseItsIdentity` failed completely silently.* The outer catch now emits an `out.warn` naming the error and pointing at `doctor --repair sysinfo-modelnum-missing`. Still non-fatal.

4. *The `mkdirSync` seam was injected but never asserted.* Added two tests: the happy path asserts it is called with `.../iPod_Control/Device`, and a failure case asserts the repair refuses without calling `setSysInfo` or `save`.

Also took the double-open nit as a comment rather than a change — re-opening after the confirm prompt is deliberate; holding a write-capable handle across a prompt the user may cancel is the worse trade, and that reasoning is now in the docstring.

Reviewer independently verified and found no issue with: the provenance invariant (grepped the whole diff scope — no surviving `MA147` default, every write sources from the cascade through `toModelNumStr`), handle closure in `finally` across all early-return branches, no `console.*` added in core, no task-ID/AC/milestone references anywhere, doctor registry wiring, and `toModelNumStr`'s idempotence (which also closes a latent double-prefix gap in the old inline `M${...}`).

**Gates after the review fixes:** lint clean; typecheck 36/36; libgpod-node build ok; devices-ipod 395/0; core 3442/0; podkit 1977/0.

**Independent review round 2 — the size heuristic was unsound; the check now parses the format.**

The reviewer showed `EMPTY_ITUNESSD_MAX_BYTES = 18` reports a broken device as healthy. libgpod's `bdhs` header is 104 bytes empty (measured), which is larger than a *populated* 1g/2g file's 18-byte header — so `size > 18` cannot distinguish empty from populated, nor either from a file the hardware cannot read. `shuffle-playback-db.ts` now reads the header instead, with both layouts taken from `itdb_shuffle_write_file`:

- **v1** (1g/2g): big-endian 24-bit track count at 0, then the constants `0x010600` and `0x000012` (its own 18-byte header length). Those two constants are what tells a real header from arbitrary bytes.
- **bdhs** (3g/4g): `bdhs` magic at 0, little-endian 32-bit track count at `0x0C`.

Exported as `parseItunesSdHeader` + `expectedItunesSdFormat`, both unit-tested, and both verified against bytes libgpod actually wrote: a model-less init produces `{format:'bdhs',trackCount:0}` at 104 bytes; `model:'MA947'` produces `{format:'v1',trackCount:0}` at 18 bytes; a 3-track save produces `{format:'v1',trackCount:3}` (header hex `000003 010600 000012`).

A `bdhs` on a 1g/2g is now its own finding, distinct from 'empty' and reported whether or not the iTunesDB holds tracks — it is unreadable by that firmware either way. When neither firmware truth nor the database layer places the generation precisely, the format comparison is skipped and only emptiness is reported. The check stays a diagnostic: `repairable: false`, no `repair`, absent from `PUBLIC_REPAIR_IDS`, and the closed-handle skip test is kept.

The check's docstring no longer says a re-sync is needed after the identity repair — that repair's own `save()` runs `itdb_write` with the corrected identity, so the file is written immediately.

**Judgment call reversed from round 1.** The user-facing 'requires iTunes authentication' copy for shuffle 3g/4g (`tables/unsupported.ts` `SHUFFLE_REASON`, `tables/libgpod-mapping.ts`, `podkit-core/src/ipod/device-validation.ts`) was left alone last round; it is now corrected, because the codebase asserting a claim its own docs debunk is worse than the churn. The refusal is unchanged — only its justification: these devices are read-only because the `bdhs` write has never been confirmed on hardware, not because anything cryptographic blocks it. Swept the same claim out of `devices-ipod/src/types.ts`, `device-types/src/ipod-model.ts`, `docs/devices/supported-devices.mdx`, `docs/devices/ipod-internals.md`, `devices/ipod.md`, `documents/formats/generations.md`, `documents/architecture/device/identity-support-matrix.md`, and the shuffle rejection persona + its VM expectation (whose pinned headline was already stale against `SHUFFLE_REASON`). Test assertions moved to the new wording.

`documents/formats/itunessd-bdhs.md` claimed libgpod 'only emits bdhs for a device it has resolved to a shuffle 3g/4g' — false, and the reason the defect above exists. Corrected, along with the open question that still described the imaginary signature.

`documents/test-devices.md`: the shuffle 2G's model number row now reads `A947 (suffix 436, 1GB Pink)`, and the 'Known defect' block is replaced by a description of why that unit matters as the regression device.

`.changeset/shuffle-playback-database.md`: dropped the line about removing an interim refusal that never shipped; the doctor bullet now describes format detection.

**Gates.** lint clean; typecheck 36/36; libgpod-node build ok; devices-ipod 395/0; core 3460/0; podkit 1980/0.

Hardware verified 2026-08-17 on the pink iPod shuffle 2G (serial 6V925GZ9436). `doctor --repair sysinfo-modelnum-missing` wrote `ModelNumStr: MA947`, derived from the device's own serial via the newly added `436 -> A947` mapping. A subsequent sync produced an iTunesSD of 1692 bytes = 18-byte header + 3 x 558-byte records, header count 0x000003, format constants 0x010600 / 0x000012 — the V1 (1g/2g) layout, byte-for-byte what libgpod's writer emits. A 28-track sync produced 15642 bytes = 18 + 28 x 558, count 0x1c. The device plays.

The interim refusal added alongside this work was removed as part of it and its task closed as superseded — it never reached a release.
<!-- SECTION:NOTES:END -->
