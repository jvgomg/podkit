---
id: TASK-479.05
title: >-
  device init/reset/add writes a fabricated iPod Video identity (ModelNumStr:
  MA147)
status: Done
assignee: []
created_date: '2026-08-13 21:18'
updated_date: '2026-08-18 01:20'
labels:
  - identity
  - data-integrity
  - libgpod-node
milestone: m-18
dependencies: []
parent_task_id: TASK-479
priority: high
ordinal: 248000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`packages/libgpod-node/native/gpod_binding.cc:142-146` defaults `model` to `"MA147"` — an iPod Video 60GB — when `itdb_init_ipod` is called without one. **Every production caller omits the model**: `packages/podkit-cli/src/commands/device/init.ts:264`, `packages/podkit-cli/src/commands/device/reset.ts:231`, `packages/podkit-cli/src/commands/device/add.ts:1057`.

libgpod then does `itdb_device_set_sysinfo(itdb->device, "ModelNumStr", model_number)` (`tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_itunesdb.c:8163-8166`) and `itdb_create_directories` writes `iPod_Control/Device/SysInfo` whenever the model number is non-empty (`:8506-8512`).

So `podkit device reset` on **any** iPod writes `ModelNumStr: MA147` to the device — fabricated, frequently the wrong generation, with no backup and no provenance marking. `reset.ts:214` sweeps the database first, guaranteeing the branch fires.

## Why it matters beyond the wrong string

podkit reads its own fabrication back as evidence:

- `packages/ipod-firmware/src/sysinfo/read.ts:137-153` and `:201` fold classic-SysInfo `ModelNumStr` into identity when SysInfoExtended lacks one (pinned by `ensure.test.ts:189-200`)
- `packages/podkit-cli/src/commands/device/verification-policy.ts:66-73`, `:156-159` — `hasSysInfoModelNumber` makes `isIdentityFullyEmptyView` return false, so the fabricated line silently upgrades a device past the empty-identity refusal on a later `device add`

It also contradicts a guard written deliberately elsewhere: `packages/podkit-core/src/diagnostics/checks/sysinfo-modelnum-mismatch.ts:340-352` refuses to rewrite `ModelNumStr` precisely when firmware truth carries no model number, and backs the file up before touching it (`:379`).

## Direction

Pass the cascade-resolved model number when podkit has one, and refuse to write a fabricated one when it does not. Note this interacts with TASK-479.01, which sets `ModelNumStr` deliberately from hardware-attested data — the difference is provenance: 479.01 writes a model podkit resolved from the device, this task stops writing one podkit invented.

Related, lower severity: the same fabrication is hardcoded in `packages/virtual-ipod-server/src/image.ts:57-61` and `tools/gpod-tool/gpod-tool.c:167` (synthetic devices only, likely fine), and the public docs instruct users to hand-author the file — `docs/devices/ipod-internals.md:86`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `device init`, `device reset` and `device add` never write a model number podkit did not resolve from the device
- [x] #2 When the cascade has a model number, it is passed through instead of the `MA147` default
- [x] #3 When it does not, initialisation either omits the model number or refuses — whichever libgpod supports without writing a fabricated SysInfo
- [x] #4 Any existing device carrying a podkit-written `MA147` can be detected and corrected via doctor
- [x] #5 The `MA147` default in `gpod_binding.cc` is removed or made explicit-only
- [x] #6 Regression test asserts no `ModelNumStr` is written for a device with unresolved identity
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (not committed) in worktree .claude/worktrees/task-479-identity, alongside TASK-479.01 (one code path).

**The default is gone.** `packages/libgpod-node/native/gpod_binding.cc` no longer seeds `model` with `"MA147"`. An omitted (or empty) model now passes `nullptr` to `itdb_init_ipod`, whose `if (model_number)` guard then skips `itdb_device_set_sysinfo`, and `itdb_create_directories` only writes `iPod_Control/Device/SysInfo` when `ModelNumStr` is non-empty — so no SysInfo file is created at all. Confirmed against the libgpod source, then proved end-to-end: initialising into a temp dir with `model: 'MA947'` produces `ModelNumStr: MA947`; without a model, no SysInfo file exists. Checked that `itdb_create_directories` tolerates an unknown model — it does, taking the capacity-derived musicdirs count (20/50, a superset) and creating Artwork/Photos anyway via its explicit `ITDB_IPOD_MODEL_UNKNOWN` clauses.

**What happens when no model number is available:** initialisation proceeds normally and writes no SysInfo. The device keeps whatever identity it already had; nothing is invented and nothing is destroyed. This is the honest option AC#3 asks for — libgpod supports it directly, so a refusal was unnecessary.

**Callers.** All three now pass the cascade-resolved value or nothing:
- `device add` (`finishIpodAdd`) already holds an `IpodIdentityAssessment`, so it uses `assessment.model.modelNumber`.
- `device init` and `device reset` ran no cascade at all. Rather than scraping libgpod's own (unreliable) view, a shared `resolveInitModelNumStr(core, deps, mountPoint)` was added to `commands/device/shared.ts`; it calls `assessIpodIdentity` through a new injectable `DeviceOpDeps.assessIdentity` seam. In `reset` it runs *before* the sweep, so the identity is read while the device is still intact.
- It never throws: an identity probe failure returns `undefined`, which means 'write no model number' — never 'write the old default'.

**Prefix.** `IpodModel.modelNumber` is stored bare (`A947`), but SysInfo and libgpod's lookup both want the M-prefixed form — libgpod strips exactly one leading alpha before its table lookup, so a bare code would miss. A new exported `toModelNumStr` in `@podkit/devices-ipod` does the prefixing, replacing the inline `M${...}` that `sysinfo-modelnum-mismatch` had been doing on its own.

**Tests (AC#6).** `device-ipod-ops.behavior.test.ts` — init passes `MA947` through / passes nothing when the cascade resolves no model number / passes nothing when the probe throws. `device-reset.unit.test.ts` — the same three for reset. `packages/libgpod-node/src/__tests__/init-ipod-model.integration.test.ts` (new) proves the native behaviour directly: no SysInfo file at all when no model is given, and none for an empty-string model either.

**Judgment calls.**
- Changeset is **minor**, not patch: `Database.initializeIpod` losing its default is a behaviour change for any external consumer that relied on it (a minor bump for a breaking CLI/library change is this project's convention). Nothing in-repo relied on it — `test-packages/gpod-testing/src/test-ipod.ts:96` has its own explicit `'MA147'` default, so every test fixture is unaffected.
- An empty-string model is treated as no model. Passing `''` would otherwise reach libgpod's `strlen(model_number) != 0` check and silently do nothing useful; collapsing it to the same branch keeps one behaviour instead of two.
- Left alone per the task body: `packages/virtual-ipod-server/src/image.ts` and `tools/gpod-tool/gpod-tool.c` (synthetic devices — and both already pass a model explicitly, so the removed default does not affect them). `docs/devices/ipod-internals.md:86` still instructs users to hand-author SysInfo; not touched.

**AC#4 not done.** Detecting an existing device carrying a podkit-written `MA147` needs a separate doctor rule. `sysinfo-modelnum-mismatch` already catches the case where firmware truth disagrees with it, which is the harmful subset; the remaining case (a real iPod Video 5G that was reset by podkit, where `MA147` is indistinguishable from correct) has no signal to key off and needs its own decision. Left unchecked.

**Gates.** lint clean; typecheck 36/36; `bun run build --filter @podkit/libgpod-node` ok (node-gyp rebuild); devices-ipod 390/0, core 3439/0, podkit 1971/0.

**Files changed.** `packages/libgpod-node/native/gpod_binding.cc`, `packages/libgpod-node/src/database.ts` (docs), `packages/libgpod-node/src/__tests__/init-ipod-model.integration.test.ts` (new); `packages/podkit-core/src/ipod/database.ts` (docs); `packages/podkit-cli/src/commands/device/shared.ts`, `device/init.ts`, `device/reset.ts`, `device/add.ts`, `commands/device-ipod-ops.behavior.test.ts`, `commands/device-reset.unit.test.ts`; `.changeset/no-fabricated-model-number-on-init.md` (new).

**Post-implementation review (sonnet) — findings relevant to this task.**

The C++ change was checked specifically for lifetime and UB: `model` is a stack `std::string` alive through the synchronous `itdb_init_ipod` call, so `hasModel ? model.c_str() : nullptr` cannot dangle. The reviewer independently ran `init-ipod-model.integration.test.ts` against the real built addon (3/3) and confirmed the behaviour end-to-end — omitted or empty model writes no SysInfo at all, a supplied model is written verbatim.

The reviewer also grepped the whole diff scope for `'MA147'` and confirmed the only surviving hits are the still-valid `IpodModels.VIDEO_60GB` named constant and doc examples — no default assignment survives anywhere.

One gap it found that touches this task: `device add`'s `initializeIpod` model pass-through had no test (all 50 existing `device-add.unit.test.ts` tests passed unchanged against the diff, proving the path was never exercised). `device init` and `device reset` were already covered here. Added a `runDeviceAdd: SysInfo model number` block covering the fresh-database branch both ways — `MA947` passed through for a serial-resolved model, no `model` key at all for a USB-only model that carries no model number. `device-add.unit.test.ts` is now 56 tests.

**Gates after the review fixes:** lint clean; typecheck 36/36; `bun run build --filter @podkit/libgpod-node` ok; devices-ipod 395/0; core 3442/0; podkit 1977/0.

**Independent review round 2 — removing the default exposed a second libgpod branch, now handled.**

The reviewer found that a NULL model number does not merely skip the SysInfo write. `itdb_init_ipod` also has `if (!model_number || itdb_device_is_shuffle(device))`, so an unidentified device gets an `iTunesSD` written for it — and with no generation, `is_shuffle_2g()` is FALSE, so the format is the 3g/4g `bdhs`. Measured through the built binding: `{name}` → 104-byte `bdhs`, 50 music dirs; `{model:'MA947'}` → 18-byte v1, 3 music dirs. A blank shuffle 1g/2g reaches this: with no SysInfoExtended the cascade resolves it by USB PID alone, and `synthesizeFromGeneration` deliberately carries no model number.

Two fixes, split by what podkit knows:

1. **Identified as a shuffle, model number unknown → refuse.** New `assertInitIdentitySufficient` in `commands/device/shared.ts`, called from `resolveInitModelNumStr` (so `device init` and `device reset` get it) and directly from `device add`'s init branch, outside its try so the refusal is not re-wrapped as `INIT_FAILED`. New `DeviceErrorCodes.MODEL_NUMBER_REQUIRED`; the message sends the user to `podkit doctor --repair sysinfo-extended`, which writes SysInfoExtended from firmware → serial → model number (the newly added `436` → `A947` mapping closes that loop for the regression device). No generation-representative model number is invented to get past it. Both callers now resolve identity *before* announcing or prompting — `device reset` refuses before offering to wipe the device.

2. **Not identified at all → initialise, then discard the file.** `IpodDatabase.initializeIpod` samples whether an `iTunesSD` exists before the init and, when no model number was supplied, deletes one that appeared (`discardUnvouchedPlaybackDatabase`). A file the device already had is never touched — libgpod skips its write when one is present, so anything surviving is the device's own. Durable: `itdb_write` writes `iTunesSD` only for `itdb_device_is_shuffle`, so a later save does not recreate it.

Covered by unit tests on the discard policy (created / pre-existing / absent), CLI behaviour tests (a shuffle known only by generation refuses and never calls `initializeIpod`; a nano known only by generation initialises with no model), and two integration tests against the real binding. Verified empirically end-to-end: through `IpodDatabase.initializeIpod`, a model-less init now leaves **no** `iTunesSD` (50 music dirs, no SysInfo), `MA947` leaves the 18-byte v1 file (3 music dirs, `ModelNumStr: MA947`), and `MA147` leaves no `iTunesSD` at all (libgpod writes none for a non-shuffle it can identify).

**Artwork directories (unexamined behaviour change, now documented).** `itdb_create_directories` gates `iPod_Control/Artwork` and `Photos/Thumbs` on `supports_artwork() || model == UNKNOWN`, and a NULL model yields INVALID, not UNKNOWN — so a model-less init no longer pre-creates them. Confirmed by probe (`Artwork: absent` without a model, `present` with `MA147`). Benign — both writers `g_mkdir` on demand — and now called out in the changeset.

**Gates.** lint clean; typecheck 36/36; libgpod-node build ok; devices-ipod 395/0; core 3460/0; podkit 1980/0; the two new core integration tests pass against the real binding.

AC #4 was left open as undecidable — the reasoning being that on a genuine iPod Video 5G a `ModelNumStr` of `MA147` is indistinguishable from correct. Hardware settled it on 2026-08-18: a real iPod nano 4G (16GB Orange, GUID 000A27001BFFB6F6) was found carrying `ModelNumStr: MA147`, written by podkit in an earlier session. Firmware identity is the discriminator, it is read-only, and the existing `sysinfo-modelnum-mismatch` check already uses it — it flagged the device, and its repair rewrote `MA147 -> MB911` with the original preserved at `SysInfo.podkit-backup`. Doctor green afterwards, all three identity surfaces agreeing.

That device had been syncing under a wrong model profile (artwork formats, video support and checksum type all derive from model identity) for as long as the fabricated value had been on it.
<!-- SECTION:NOTES:END -->
