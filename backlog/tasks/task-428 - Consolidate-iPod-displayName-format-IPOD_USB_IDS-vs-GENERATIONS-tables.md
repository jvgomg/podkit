---
id: TASK-428
title: 'Consolidate iPod displayName format: IPOD_USB_IDS vs GENERATIONS tables'
status: Done
assignee: []
created_date: '2026-06-15 21:52'
updated_date: '2026-06-20 17:25'
labels:
  - device-capability-architecture
  - follow-up
  - ipod-identification
  - devices-ipod
milestone: m-18
dependencies: []
priority: low
ordinal: 143000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The iPod identity cascade has two upstream displayName format conventions that disagree:

- **`IPOD_USB_IDS` (USB-source)** — `packages/devices-ipod/src/usb-ids.ts` (approximate). Lowercase, no parens. Example: `"iPod nano 3rd generation"`.
- **`GENERATIONS` (sysinfo/serial-source)** — `packages/devices-ipod/src/generations.ts` (approximate). Parenthetical, capital G. Examples: `"iPod (5th Generation)"`, `"iPod nano (3rd Generation)"`.
- **`MODEL_NUMBERS` (model-number-source)** — emits the rich `GENERATIONS`-form displayName.

Surfaced during the m-18 DiscoveredDevice work: `displayFor(d)` in `@podkit/core/discovery.ts` had to add a `shortenIpodLabel` adapter that handles both formats with two regexes. The adapter masks the inconsistency at the display boundary but doesn't fix the root cause.

## What would consolidation look like?

Pick one format. Either:

a. Both tables emit lowercase-plain (`"iPod nano 3rd generation"`) — simpler, no parens to strip, but loses the visual gen marker for the bare `"iPod (5th Generation)"` case.

b. Both tables emit parenthetical (`"iPod nano (3rd Generation)"`) — keeps the visual marker. `IPOD_USB_IDS` strings need updating.

c. Both tables emit a structured `{ family, generation }` object — no formatted string at the source; format happens at the display layer (`displayFor`).

Lean (c). The family + integer is the irreducible information; everything else is presentation. The shortener and reader would compose from it; no parsing required.

## Why it matters

- Every consumer that wants a "iPod nano 3G" short label has to either look at the underlying source enum (USB / sysinfo / serial / model-number) and pick the right shortener, OR run `shortenIpodLabel` against the rendered string. The latter is what `displayFor` does today; it's brittle.
- New iPod entries (Rockbox variants, future personas) have to remember which format applies.
- `shortenIpodLabel`'s known pass-through for `"iPod Video (5.5th Generation)"` (TASK-429) goes away naturally if the source is structured.

## Out of scope

`shortenIpodLabel` itself stays as the adapter layer until consolidation lands. Don't churn it preemptively.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Choose a format (likely structured `{ family, generation }`) and document the decision in an ADR
- [x] #2 Migrate `IPOD_USB_IDS`, `GENERATIONS`, and `MODEL_NUMBERS` to the chosen shape — single source of truth for each iPod's identity
- [x] #3 `displayFor` composes from the structured fields rather than parsing strings; `shortenIpodLabel` adapter deleted
- [x] #4 5.5G iPod Video renders correctly without a special case (closes TASK-429)
- [x] #5 All identity-resolver paths (`identify({ from: 'usb' | 'sysinfo' | 'serial' | 'model-number' })`) still produce equivalent `IpodModel` output
- [x] #6 Updated tests pin the new shape; no snapshot drift in scan/info/doctor renders
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Approach (c) from the description landed: structured `family: string` + `ordinal: number | null` on every `IpodGeneration` entry plus a derived display layer (`formatIpodLabel` / `formatIpodShortLabel`). The hand-curated `displayName` strings are gone from `IPOD_USB_IDS`, `GENERATIONS`, `MODEL_NUMBERS`, and `IpodModelVariant`. `IpodModel` exposes `family`+`ordinal` so consumers compose short labels without parsing strings.

Key wiring:
- `packages/devices-ipod/src/format.ts` — new `formatIpodLabel` + `formatIpodShortLabel`. Pinned by `format.test.ts`.
- `identity.ts` and `resolve.ts` compose `IpodModel.displayName` via the formatter.
- `discovery.ts` (`displayFor`) drops `shortenIpodLabel`; reads `model.family/ordinal` directly. TASK-429's `5.5G iPod Video` special case disappears.
- `lookupBySerial` no longer invents a synthetic `classic_1g` for unknown model numbers — returns `undefined` so the cascade falls through to other axes.

ADR-020 documents the decision and the variant-tag placement convention (`{family}{variant}{capacity}{color}{(ordinal Generation[, refresh])}`). A handful of edge-case strings normalised: `iPod Photo U2 20GB` (was `iPod Photo 20GB U2`) and `iPod Video U2 30GB (5.5th Generation)` (was `iPod Video 30GB U2 (5.5th Generation)`) — formatter prefers `variant` after family for consistency with `iPod U2 25GB (4th Generation)`.

Quality: full `bun run test` + `bun run typecheck` clean. ~30 test files updated to pin new canonical strings; `IpodModel` stub literals across the suite gained `family`+`ordinal`.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

- Replaced the three diverging `displayName` conventions (`IPOD_USB_IDS` lowercase, `GENERATIONS` parenthetical, `MODEL_NUMBERS` rich) with a single structured shape: `family: string` + `ordinal: number | null` on `IpodGeneration` and `IpodModel`.
- New formatters `formatIpodLabel` / `formatIpodShortLabel` in `@podkit/devices-ipod` are the only place that renders display strings. `identify()` composes `displayName` via the formatter; `displayFor` reads `model.family/ordinal` directly.
- Deleted `shortenIpodLabel` regex pair in `@podkit/core/discovery.ts`. The TASK-429 `5.5G iPod Video` special case dissolved naturally — decimal ordinal is now a number, not a string to parse.
- `MODEL_NUMBERS` keeps only variant-specific data (`generation`, `capacityGb?`, `color?`, `variant?`). The `variant` field captures `U2`, `2015`, etc. and is placed by the formatter between family and capacity for uniformity.

## ADR

ADR-020 documents the decision, the canonical format shape, and the few edge-case renames (`iPod Photo U2 20GB`, `iPod Video U2 30GB (5.5th Generation)`).

## Quality

- `bun run test` — all 4800+ tests pass.
- `bun run typecheck` — clean across every workspace.
- `bun run lint` — clean.
- New `format.test.ts` pins the formatter contract independently of the identification tables.

## Hardening

- `lookupBySerial` no longer invents `classic_1g` when the serial-table model number is missing from `MODEL_NUMBERS` — returns `undefined` so the cascade falls through to other axes.

## Closes

- TASK-429 — 5.5G iPod Video special case eliminated.
<!-- SECTION:FINAL_SUMMARY:END -->
