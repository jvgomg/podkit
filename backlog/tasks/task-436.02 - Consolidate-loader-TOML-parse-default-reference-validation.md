---
id: TASK-436.02
title: Consolidate loader TOML parse + default-reference validation
status: Done
assignee: []
created_date: '2026-06-24 15:19'
updated_date: '2026-06-24 16:02'
labels:
  - config
  - refactor
dependencies: []
parent_task_id: TASK-436
ordinal: 183000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Behavior-neutral refactor of `config/loader.ts`.

Collapse the ~30 copy-pasted "type-check primitive → validate enum → throw context-tagged error → assign" TOML scalar/enum parse blocks into a shared parse helper, retrofitting the existing call sites (use the existing capability-fields parser as prior art). Collapse the three copy-pasted default-reference validation blocks (`defaults.music`/`video`/`device`) into a single `validateRef(name, kind, registry)`-style helper.

This lands the shared helpers that the per-device feature slices build on, without changing any current behavior or warning text.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 24, 25.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Repeated scalar/enum TOML parse blocks in loader.ts are routed through one shared helper, with existing call sites retrofitted
- [x] #2 The three default-reference validation blocks are collapsed into a single reusable validateRef helper
- [x] #3 Existing loader tests pass with no behavior or warning-text changes
- [x] #4 No new copy-pasted parse/validate block is introduced
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Behavior-neutral consolidation of `packages/podkit-cli/src/config/loader.ts`. No public API / PodkitConfig shape changes. All strings reproduced verbatim.

## Shared parse helpers (4 extracted, all private to loader.ts)
Modeled on `parseCapabilityFields`. Each takes a single args object and an `assign` callback so the call site keeps its target field's narrow type:

- `parseStringEnum<T extends string>({ raw, field, context, valid, assign, label?, throwOnWrongType? })` — the core "type-check → enum-validate → context-tagged throw → assign" pattern. `context` is the full tag as it appears in the message (`'config'` or `` `[devices.${name}]` ``). Two message forms reproduced exactly: type error `Invalid type for "${field}" in ${context}. Expected string, got ${typeof}.` and value error `Invalid ${label ?? field} value "${raw}" in ${context}. Valid values: ${valid.join(', ')}`. `throwOnWrongType` distinguishes the two historical sub-patterns: top-level blocks used a non-throwing `typeof === 'string'` guard (false / default); per-device blocks throw on wrong type (true). `label` covers the one asymmetry where device `type` reports field `"type"` in the type error but `device type` in the value error.
- `parseIntegerInRange({ raw, field, context, min, max, rangeText, assign })` — customBitrate. `rangeText` supplied per call (e.g. `Must be an integer between 64 and 320.`).
- `parseNumberInRange({ ... })` — bitrateTolerance (non-integer range).
- `parseBoolean({ raw, field, context, assign, throwOnWrongType? })` — artwork/tips/checkArtwork/skipUpgrades/allowEmptyPlaylist. Same throwOnWrongType split (top-level silent skip vs per-device throw).

This replaced the now-dead helpers `qualityError()` and `isValidDeviceType()` (both removed; `DeviceType` import dropped as it became unused). The `parseStringEnum` default value-error format is byte-identical to the old `qualityError()` output.

## validateRef signature (for downstream per-device-defaults slices)
```ts
function validateRef(args: {
  value: string | undefined;       // the reference (no-op when undefined)
  label: string;                   // LHS as printed, e.g. 'defaults.music' or 'devices.terapod.defaultMusic'
  kind: string;                    // referent noun, e.g. 'music collection' | 'video collection' | 'device'
  availableLabel: string;          // plural noun for the list, e.g. 'collections' | 'devices'
  registry: Record<string, unknown> | undefined;  // record the key is looked up in
}): void
```
Emits exactly: `Warning: ${label}="${value}" references a non-existent ${kind}. Available ${availableLabel}: ${keys join ', ' || '(none)'}`. Non-throwing (advisory). A future caller validates `devices.x.defaultMusic` against `music` by passing `label: 'devices.x.defaultMusic'`, `kind: 'music collection'`, `availableLabel: 'collections'`, `registry: music`.

## Retrofitted call sites
13 throwing scalar/enum blocks: top-level (quality, audioQuality, videoQuality, encoding, customBitrate, bitrateTolerance, artwork, tips, checkArtwork, transferMode, skipUpgrades, allowEmptyPlaylist) + per-device (type, quality, audioQuality, videoQuality, encoding, customBitrate, bitrateTolerance, artwork, checkArtwork, transferMode, skipUpgrades). 3 default-reference blocks → validateRef.

## Intentionally NOT migrated (out of scope — not the throwing pattern)
- `loadEnvConfig` / `loadCliConfig` blocks: silent-ignore-on-invalid (no throw, no context tag); they reuse the existing `isValid*` predicates.
- `parseDefaults` (typeof==='string' assignment, no validation/throw).
- Per-device `path`/`volumeUuid`/`volumeName`/`manufacturer`/`productName`/`pathTemplate`/`unsupported`: bespoke (trim/template/inline-table/legacy-coercion logic), not the uniform enum pattern.
- Capability + content-path fields already go through `parseCapabilityFields`.

## Gates (all green)
- typecheck: pass
- lint: oxlint 0 warnings/0 errors + stderr-writes convention check pass
- build: pass
- unit: 1817 pass / 0 fail across the package suite; loader.test.ts 245 pass / 0 fail with NO assertion changes.
<!-- SECTION:NOTES:END -->
