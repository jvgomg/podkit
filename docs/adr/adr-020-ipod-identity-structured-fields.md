---
title: "ADR-020: Structured iPod Identity Fields"
description: Replace hand-curated displayName strings on USB/SysInfo/serial tables with structured family + ordinal fields; format strings at the display layer.
sidebar:
  order: 21
---

# ADR-020: Structured iPod Identity Fields

## Status

**Accepted** (2026-06-20)

## Context

`@podkit/devices-ipod` carries three upstream identity tables — `IPOD_USB_IDS`, `GENERATIONS`, and `MODEL_NUMBERS` — each of which historically stored a hand-written `displayName` string. The tables disagreed on format:

- `IPOD_USB_IDS` used a compact lowercase form: `iPod nano 3rd generation`.
- `GENERATIONS` used a parenthetical form with a capital `G`: `iPod nano (3rd Generation)`, `iPod (5th Generation)`.
- `MODEL_NUMBERS` matched `GENERATIONS` but added capacity and colour: `iPod nano 8GB Black (3rd Generation)`.

This surfaced during the m-18 `DiscoveredDevice` work (TASK-427). The CLI's `displayFor(d)` needed to produce a short label (`iPod nano 3G`) regardless of which source the cascade picked. The fix at the time was a `shortenIpodLabel` adapter using two regexes — one for each surface form. The adapter masked the inconsistency at the display boundary but didn't fix the root cause.

Symptoms:

- Every consumer that wanted a short label had to inspect the underlying `IpodModelSource` and pick a shortener, or run the regex-based adapter against a rendered string.
- New entries (Rockbox variants, future personas) had to remember which format applied.
- `iPod Video (5.5th Generation)` was a documented pass-through (TASK-429) because the decimal ordinal broke the adapter's pattern.

## Decision

Drop the hand-curated `displayName` strings from the upstream tables. Encode the irreducible identity as structured fields on the canonical generation entry; format at the display layer.

### Structured fields on `IpodGeneration`

Two new required fields on each `IpodGeneration` entry in `tables/generations.ts`:

- `family: string` — the marketing family name without the generation marker. Examples: `"iPod"`, `"iPod Video"`, `"iPod Classic"`, `"iPod nano"`, `"iPod Photo"`.
- `ordinal: number | null` — the generation number as written in the marketing name. `1` for 1st, `5.5` for 5.5th. `null` for entries that never carried a generation marker (`photo`).

These fields are the single source of truth for family + generation identity. The legacy `displayName` field is removed from `IpodGeneration`; rich labels are composed by `formatIpodLabel`.

### `IPOD_USB_IDS` becomes `{ generation }` only

The USB table no longer stores a `displayName`. Each entry just maps a product ID to an `IpodGenerationId`. `identify({ from: 'usb' })` composes the label from `GENERATIONS[gen].family/ordinal`.

### `MODEL_NUMBERS` keeps only variant data

Each `ModelEntry` carries `{ generation, capacityGb?, color?, variant? }` — the variant-specific facts not derivable from the generation entry. The `variant` field captures special tags such as `"U2"`, `"2015"`, or unusual SKU markers.

### Formatter functions

Two pure formatters in `@podkit/devices-ipod`:

- `formatIpodLabel(parts): string` — rich label. Composes `${family}[ ${variant}][ ${capacity}][ ${color}] [(${ordinal-suffix} Generation)]`. Handles sub-GB capacities (`512MB`), drops the gen marker when `ordinal === null`.
- `formatIpodShortLabel(parts): string` — `${family} ${ordinal}G` (e.g., `iPod nano 3G`, `iPod Video 5.5G`). Returns `${family}` alone when `ordinal === null`.

### `IpodModel` carries the structured fields

The `IpodModel` interface in `@podkit/device-types` gains `family: string` and `ordinal: number | null`. `displayName` remains for backward compatibility (computed via `formatIpodLabel` inside `identify()`). Consumers that need a short label call `formatIpodShortLabel(model)` instead of running a regex against `displayName`.

### `shortenIpodLabel` is deleted

`displayFor` in `@podkit/core/discovery.ts` reads `model.family/ordinal` directly. The regex adapter is removed. The TASK-429 `5.5G iPod Video` special case disappears — the decimal ordinal is now a number, not a string to parse.

## Alternatives considered

**(a) Lowercase-plain everywhere.** Migrate `GENERATIONS` and `MODEL_NUMBERS` to the lowercase form. Loses the visual gen marker for the bare `iPod (5th Generation)` case and keeps the implicit "consumers must parse strings" coupling.

**(b) Parenthetical everywhere.** Migrate `IPOD_USB_IDS` to match `GENERATIONS`. Still requires regex-based shortening; doesn't address the root issue.

**(c) Structured fields — this ADR.** Family + ordinal are the irreducible information. The shortener and reader compose from them; no parsing required. The TASK-429 special case dissolves naturally.

## Consequences

- Tables are smaller and unambiguous: USB-IDs lose a redundant field, model-numbers lose hand-typed strings that drift from the generation source.
- Adding a new generation requires picking `family` + `ordinal`; the format is enforced by the formatter, not by editor discipline.
- The variant-format edge cases (`iPod U2 25GB`, `iPod Photo 20GB U2`, `iPod nano 16GB Blue (7th Generation, 2015)`) normalise to one shape: `${family}${variant}${capacity}${color}${(ordinal Generation)}`. A handful of rendered strings change (the `U2` placement moves consistently between family and capacity); tests are updated to pin the new shape.
- `displayFor` is one cascade-aware function, not a regex pair.

## References

- TASK-428 — implementation tracking
- TASK-427 — m-18 DiscoveredDevice work that surfaced the inconsistency
- TASK-429 — closed by this change (5.5G special case disappears)
- ADR-014 — m-18 device capability architecture (sets the four-package boundary this fits inside)
