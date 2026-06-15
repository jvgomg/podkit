---
id: TASK-428
title: 'Consolidate iPod displayName format: IPOD_USB_IDS vs GENERATIONS tables'
status: To Do
assignee: []
created_date: '2026-06-15 21:52'
updated_date: '2026-06-15 21:54'
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
- [ ] #1 Choose a format (likely structured `{ family, generation }`) and document the decision in an ADR
- [ ] #2 Migrate `IPOD_USB_IDS`, `GENERATIONS`, and `MODEL_NUMBERS` to the chosen shape — single source of truth for each iPod's identity
- [ ] #3 `displayFor` composes from the structured fields rather than parsing strings; `shortenIpodLabel` adapter deleted
- [ ] #4 5.5G iPod Video renders correctly without a special case (closes TASK-429)
- [ ] #5 All identity-resolver paths (`identify({ from: 'usb' | 'sysinfo' | 'serial' | 'model-number' })`) still produce equivalent `IpodModel` output
- [ ] #6 Updated tests pin the new shape; no snapshot drift in scan/info/doctor renders
<!-- AC:END -->
