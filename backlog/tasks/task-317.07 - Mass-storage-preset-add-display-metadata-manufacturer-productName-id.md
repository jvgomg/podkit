---
id: TASK-317.07
title: 'Mass-storage preset: add display metadata (manufacturer, productName, id)'
status: Done
assignee: []
created_date: '2026-05-09 15:55'
updated_date: '2026-06-15 22:27'
labels:
  - mass-storage
  - ux
  - presets
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: low
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The mass-storage `MassStoragePreset` type currently carries only capability data (codecs, artwork sources, content paths, etc.). The display name shown in `device add` output (`Type: Echo Mini`) is hardcoded in a CLI-side switch at `packages/podkit-cli/src/commands/open-device.ts:62`. This is a leaky abstraction: presets define both behavior and identity, but identity lives in the CLI.

User feedback during m-18 sweep: when adding an Echo Mini, the `Type:` line could be richer — `FiiO Snowsky Echo Mini (echo-mini)` instead of just `Echo Mini`. The pattern: `<manufacturer> <productName> (<id>)`. Manufacturer + product helps users disambiguate when multiple presets share short names; the id in parentheses gives the exact `--type` token they'd use on the command line.

## What to add

Extend `MassStoragePreset` (in `packages/devices-mass-storage/src/preset.ts` and `presets/types.ts`) with:

- `manufacturer: string` — vendor / brand (e.g., `'FiiO Snowsky'`, `'Rockbox community'`).
- `productName: string` — short product name (e.g., `'Echo Mini'`).
- `id` is already the preset key (e.g., `'echo-mini'`) — keep as-is.

Compute display strings via a helper in `@podkit/devices-mass-storage`:

- `formatPresetDisplay(preset: MassStoragePreset): string` → `'FiiO Snowsky Echo Mini (echo-mini)'` (the rich form for `device add`).
- `formatPresetShortDisplay(preset)` → `'Echo Mini'` (the short form for tables / `device list` columns).

Replace the hardcoded `getDeviceTypeDisplayName` switch in `commands/open-device.ts` with calls to these helpers.

Update built-in presets in `presets/built-in.ts`:

- `echo-mini` → `manufacturer: 'FiiO Snowsky'`, `productName: 'Echo Mini'`
- `rockbox` → `manufacturer: 'Rockbox community'` (or similar), `productName: 'Rockbox device'`
- `generic` → `manufacturer: 'Generic'`, `productName: 'Mass-storage device'`

User-defined presets (per the framework's user-extensibility) must also provide these fields. Add them as required in the type so existing user-extending consumers update consistently.

## Acceptance Criteria
<!-- AC:BEGIN -->
See AC list. Affects display only; capability behavior unchanged.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 `MassStoragePreset` type gains required `manufacturer: string` and `productName: string` fields. The preset id remains the lookup key.
- [ ] #2 `formatPresetDisplay` and `formatPresetShortDisplay` helpers added in `@podkit/devices-mass-storage`, exported and used everywhere display strings are rendered.
- [ ] #3 Hardcoded `getDeviceTypeDisplayName` switch in `commands/open-device.ts` removed; replaced with helper calls keyed on the actual preset.
- [ ] #4 Built-in presets (echo-mini, rockbox, generic) updated with manufacturer + productName.
- [ ] #5 `device add --type echo-mini --path ...` output shows `Type: FiiO Snowsky Echo Mini (echo-mini)` instead of `Type: Echo Mini`.
- [ ] #6 `device list` table TYPE column shows the short form (`Echo Mini`) for compactness.
- [ ] #7 Unit tests added: each built-in preset's display strings; helper functions; round-trip through device add output.
- [ ] #8 User-defined preset documentation updated (`agents/` if relevant) to include the new required fields.
- [ ] #9 Real-hardware verification on Echo Mini: run `device add -d <name> --type echo-mini --path <Echo SD path>` and confirm the new display format. Then `device list` confirms the short form. Regression run on an iPod entry confirms nothing changes for the iPod path.
<!-- AC:END -->
