---
id: TASK-479.03
title: device info renders libgpod identity — output contradicts itself
status: Done
assignee: []
created_date: '2026-08-13 20:48'
updated_date: '2026-08-18 01:20'
labels:
  - identity
  - cli
  - ux
milestone: m-18
dependencies: []
parent_task_id: TASK-479
priority: medium
ordinal: 246000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

On a shuffle 2g, `podkit device info` prints a report that contradicts itself, `doctor`, and what `sync` actually does:

```
pinkpod  —  iPod shuffle (2nd Generation)     <- cascade, correct
Capabilities:
  - Artwork (not supported on Unknown Generation)   <- libgpod
Issues:
  ! Validation — Could not identify this iPod model from the on-disk identity
    files. podkit cannot sync this device until its identity is written to disk
```

Meanwhile `doctor` reports all checks passed and `sync` transferred 198 tracks.

`packages/podkit-cli/src/commands/device/info.ts:160` calls `validateDevice(info.device, ...)` with libgpod's view, whose `generation` is `'unknown'`; `packages/podkit-core/src/ipod/device-validation.ts:186` raises `unknown_model` off that. Only the display *name* was migrated to the cascade (`info.ts:168`).

## Precise scope (narrower than it first appears)

The `+`/`-` capability markers are **already cascade-correct** — `info.ts:119` uses `openedDeviceResult.capabilities`, derived in `open-device.ts:287-305`. What is actually wrong:

- `info.ts:680` — `modelDisplay: formatGeneration(liveStatus.model.generation)` renders "Unknown Generation" as the reason on otherwise-correct `-` bullets
- `info.ts:682` — `supportsPodcast` is the last libgpod-sourced capability rendered anywhere
- `output-types.ts:194-199` — the JSON `status.capabilities` block is libgpod's all-false fallback, and for iPods there is no `settings.capabilities` block, so it is the only capability surface JSON consumers get
- `device-validation.ts:221` — `supported: issues.every(i => i.type !== 'unsupported_device')`, so `unknown_model` does not clear it: JSON reports `supported: true` beside an issue saying podkit cannot sync
- `device-validation.ts:126` — still emits "not supported by libgpod" in user-facing copy

## Fix

Source `generation` and validation from the `IpodModel` that `openDevice` **already resolved** (`open-device.ts:287`) — no new I/O; the fix removes some, since `info.ts:163` currently re-walks `assessIpodIdentity`, duplicating a SIE read and USB correlation that `open-device.ts:265-285` just did.

Add `ipodModel` to `OpenDeviceResult`, populate `liveStatus.model` from it, drop the `validateDevice` call, and derive validation from `model.unsupportedReason` only. `unknown_model` then becomes structurally unreachable — `openDevice` already throws typed `UnknownIpodModelError` when the cascade fails, which is the correct refusal.

With that done, `validateDevice`/`formatValidationMessages`/`formatCapabilities`/`isUnsupportedGeneration` have no production callers (the other call site, `sync.ts:1037-1053`, is downstream of two cascade gates that already made the correct call and can only produce a false refusal). Delete the module rather than leave it — per the no-deprecation convention — updating `podkit-core/src/index.ts:428-431` and `packages/demo/src/mock-core.ts`.

Also delete the `access !== 'read-only'` suppressions at `info.ts:639` and `:669`. Those were added in `b41bb02e` to hide this exact contradiction on read-only shuffles; suppression-by-access-tier was the wrong axis, because the contradiction is per-*source*. A `syncable` generation that libgpod cannot identify — shuffle 2g — walks straight past them. Keep the read-only *reframing* at `:588-602`, which is deliberate UX.

## Why it shipped

TASK-317.03's target behaviour said "no libgpod-derived identity in the user-facing display path", but its AC #8 named only `info.device.modelName`. The implementation (`ec8dc854`) satisfied the AC literally and left `generation`, `capacity`, `modelNumber` and `validateDevice` untouched.

The only `device info` unit test stubs `validateDevice` to return `{supported: true, issues: []}` (`device-info-runner.unit.test.ts:231-236`), so the real one was never exercised.

## Known follow-ups (not this task)

- `video-presenter.ts:114-115` -> `video/types.ts:249-258`: `getDeviceProfileByGeneration` silently returns the `ipod-classic` profile for any unrecognised generation including `'unknown'`, so a libgpod-blind device gets classic transcode dimensions with no warning
- `device/list.ts:149-155`, `device/init.ts:265`, `device/reset.ts:145` carry libgpod-sourced identity with no cascade fallback

## Output change

`status.model.generation` moves from a libgpod name (`nano_3`) to an `IpodGenerationId` (`nano_3g`), and `status.capabilities` disappears for iPods. Rename the field to `generationId` so the break is loud. Minor bump.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `device info` on a shuffle 2g shows no "Unknown Generation" text and raises no `unknown_model` issue
- [x] #2 `generation` and validation in `device info` derive from the cascade-resolved `IpodModel`, not from libgpod
- [x] #3 The redundant `assessIpodIdentity` re-walk is removed
- [x] #4 The redundant `validateDevice` gate in `sync.ts` is removed
- [x] #5 `device-validation.ts` is deleted along with its exports, or its remaining callers are justified in the task notes
- [x] #6 The read-only suppressions that masked this contradiction are removed
- [x] #7 A `device info` test exercises the real validation path — not a stub — with libgpod returning `unknown` and the cascade returning a real model
- [x] #8 JSON output change is covered by a changeset with a minor bump
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (not yet reviewed/committed). Identity and validation in `device info` now come from the `IpodModel` that `openDevice` already resolved; libgpod's `getInfo().device` is no longer read by the command at all.

Changes:
- `open-device.ts` — `OpenDeviceResult.ipodModel?: IpodModel`, populated from the model the capabilities were derived from. `undefined` only for mass-storage (the iPod branch throws `UnknownIpodModelError` rather than returning an unresolved model).
- `device/info.ts` — dropped the `validateDevice` call, the redundant `assessIpodIdentity` re-walk (that was a duplicate SIE read + USB correlation), and the `getInfo()` read. `liveStatus.model` is now a flat projection of the cascade model; a module-scope `ipodModel` carries the structured fields to the renderer. Validation derives from `model.unsupportedReason` only. Capability-bullet tail uses `formatIpodLabel({family, ordinal})`, which reproduces the old string byte-for-byte for libgpod-identifiable devices and fixes the "Unknown Generation" case. `supportsPodcast` dropped. Both `access !== 'read-only'` suppressions removed; the read-only *reframing* kept.
- Model summary row collapses to the display name (readiness model ?? cascade model). Both already carry capacity/colour/generation, so the hand-composed `- <gen>` suffix (the second "Unknown Generation" site) is gone.
- `capability-summary.ts` — `CapabilityRenderContext` iPod variant loses `supportsPodcast`; the Podcasts bullet goes with it (it was the last libgpod-sourced capability rendered anywhere).
- `sync.ts` — post-open validation gate removed; `openResult.ipod` local became unused and was dropped. Both refusals it could raise are settled upstream by the unsupported-device gate (DEVICE_UNSUPPORTED, off `unsupportedReason`) and the unknown-model gate (UNKNOWN_IPOD_MODEL). `sync-runner.unit.test.ts` cases for both still pass — they hit the upstream gates.
- `podkit-core/src/ipod/device-validation.ts` DELETED (+ its test). Zero production callers remained: verified by grep across `packages/*/src` + `test-packages/*/src` — only exports in `core/src/index.ts` and `core/src/ipod/index.ts`, mocks in `demo/src/mock-core.ts`, and four `validateDevice` assertions in `device.integration.test.ts` (a describe block testing the deleted function directly, removed with it). `buildSyncWarnings` likewise had only test/mock callers. Post-change grep for all five function names + the module path returns nothing.

JSON break (changeset `.changeset/device-info-cascade-identity.md`, minor on podkit + @podkit/core):
`status.model.generation` (libgpod name) -> `status.model.generationId` (IpodGenerationId); `status.capabilities` removed; `status.validation.warnings` removed; `status.model.number`/`capacity` now null/0 when the cascade identified via USB only. Text output loses the Podcasts bullet.

Tests (`device-info-runner.unit.test.ts`, real validation path — only `openDevice` is stubbed, to keep native libgpod out of a unit test; the fake `getInfo()` returns generation `unknown` so any reintroduced libgpod read fails the test):
- sources status.model from the cascade when libgpod cannot identify the device
- raises no validation issue for a syncable device libgpod cannot identify
- never prints "Unknown Generation" for a device the cascade identified (text mode)
- reports the cascade refusal for a read-only generation instead of hiding it (pins the removed suppression)
- marks a device carrying an unsupported reason as unsupported in JSON
The pre-existing cascade-displayName test was folded into the first of these (it stubbed `validateDevice`, which is why this shipped); its task-ID-bearing title is gone.

Judgment calls:
1. `status.validation.warnings` dropped rather than re-derived from cascade capabilities — the warnings only restated `status.capabilities`, and re-deriving them would rebuild the duplicate capability surface this task deletes. Documented in the changeset.
2. `status.model.capacity`/`number` sourced from the cascade rather than falling back to libgpod's on-disk read; `0`/`null` means "not identified from a source that carries it" instead of a second opinion.
3. Model summary row simplified to the display name (no `(8GB) - <gen>` tail) — the tail was the other "Unknown Generation" site and is redundant with the composed display name.
4. `supportsPodcast` removed from the shared renderer rather than left unused (no-deprecation).
5. `e2e-tests/src/commands/status.test.ts` local `DeviceInfoOutput` mirror renamed to `generationId` (never asserted, kept honest).

Follow-up (not done — `packages/devices-ipod/` is owned by a concurrent slice): `getUnsupportedReasonByLibgpodName` / `UnsupportedGenerationKind` in `devices-ipod/src/tables/libgpod-mapping.ts` now have no consumers outside that package; they existed to serve `device-validation.ts`.

Gates: `bun run lint` 0 errors; `bun run typecheck` 36/36; `bun run test:unit --filter @podkit/core` 3428 pass / 0 fail; `bun run test:unit --filter podkit` 1982 tests, 0 fail. (`@podkit/ipod-web` unit fails in this worktree on a missing generated iTunesDB fixture — pre-existing, unrelated.)

Reviewed and closed 2026-08-17. Independent review confirmed `device info` reads no libgpod identity, that the old self-contradiction (`supported: true` beside a refusal) is structurally unreachable, that `device-validation.ts` had no surviving consumers, and that removing the `sync.ts` gate opened no hole — both cascade gates run before `openDevice` is called.

One regression the review caught and the lead fixed: with the read-only suppressions removed, a read-only device printed its refusal twice — once as a calm `Reason:` row, once under a ✗ marker. The first fix compared the two strings for equality, which broke as soon as the two sources worded it differently (seen live on an iPod nano 7G: the USB-PID table and the cascade headline). It now skips on the access tier rather than on matching text, with a test asserting the sentence appears exactly once.

Also fixed while verifying on hardware: `device info` advised `podkit sync --force-sync-tags` on a read-only device whose tracks can never have sync tags. `TipContext` gained `deviceSyncable`; two sync-suggesting tips stay silent for a device podkit cannot write to, pinned both ways.
<!-- SECTION:NOTES:END -->
