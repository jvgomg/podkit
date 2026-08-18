---
id: TASK-479.06
title: FamilyID provenance restructure + band invariant
status: Done
assignee: []
created_date: '2026-08-13 21:19'
updated_date: '2026-08-18 01:20'
labels:
  - identity
  - devices-ipod
  - data-quality
milestone: m-18
dependencies: []
parent_task_id: TASK-479
priority: medium
ordinal: 249000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Scope

Split out of TASK-479.02, which ships the urgent data corrections. This task changes the *shape* of the table so interpolation cannot silently recur.

1. **Provenance per entry** — replace bare `Record<number, IpodGenerationId>` with `{ generation, evidence: 'hardware' | 'inferred', source }`, mirroring the `verified` axis ADR-024 already establishes for support tiers. Consider having `lookupByFamilyId` return inferred entries only behind an explicit opt-in, so an unverified guess cannot silently drive a refusal.
2. **Band invariant test** — FamilyID is banded by device class: `<100` disk-mode click-wheel, `100-999` shuffle, `>=10000` iOS. Assert it. This single test would have caught 11 of the 28 original entries at commit time.
3. **Demote chronologically impossible entries** — 4, 5, 7, 8, 24 violate the monotonic FireWireGUID/FamilyID ordering that the six hardware anchors (3, 6, 9, 12, 15, 18) establish. Low urgency: fail-closed, mostly pre-2006 devices.

## Test contract renegotiation

`packages/devices-ipod/src/lookups.test.ts:675-693` pins five research guesses (1, 5, 7, 14, 24) as contract. They are honestly labelled "(research)" but they are still assertions that unverified values are correct. Re-label to match evidence status, or remove — but do it deliberately, not as collateral.

## Why this is separate

The corrections in TASK-479.02 are pure data with hardware behind them and can ship immediately with a changeset. This is a schema change plus a test-contract negotiation; bundling them would delay the fix that unblocks real hardware.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FamilyID entries carry explicit provenance (`hardware` vs `inferred`) with a source
- [x] #2 A band invariant test rejects any entry mapping into a band its device class cannot produce
- [x] #3 Inferred entries cannot silently drive a hard refusal — either gated behind an opt-in or surfaced as low-confidence
- [x] #4 Chronologically impossible entries (4, 5, 7, 8, 24) are demoted or removed
- [x] #5 Tests pinning research guesses are re-labelled or removed deliberately, with reasoning recorded
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in the task-479-identity worktree (not committed).

**Shape.** `FAMILY_ID_TO_GENERATION: Record<number, IpodGenerationId>` → `FAMILY_ID_TABLE: Record<number, FamilyIdEntry>` where `FamilyIdEntry = { generation, evidence: 'hardware' | 'inferred', source }`. The serial/capture trail that lived in the comment block now lives in `source` on each row, so it cannot drift from the value it justifies. `lookupByFamilyId(familyId)` keeps its signature (both callers untouched — `resolve.ts`, and core's `resolveCapabilities` via `resolveIpodModel`); new `lookupFamilyIdEntry(familyId)` returns the row with its provenance for callers that want to render confidence.

**Gating decision: evidence gates nothing at runtime; the protection is a data invariant enforced at commit time.** Following ADR-024's precedent (`verified` documents, `access` gates) rather than diverging from it. Reasoning: a runtime filter assumes the bad row ships and then makes it silently inert — the contributor sees tests pass and a table entry that does nothing, which is worse epistemics than the failure it prevents. The invariant instead *blocks the commit*: an inferred entry may only name a `syncable` generation ("a guess may open a door, never close one"). That rule is exactly what the historical `12 → touch_1g` violated, and unlike a value-pinning test it cannot be satisfied by writing the guess down more confidently.

**Invariants added** (all verified to fail on deliberately bad rows before being accepted):
1. Band — `< 100` click-wheel, `100–999` shuffle, `>= 10000` iOS, matched against the generation's own device class.
2. Chronology — each *inferred* entry must fall inside the release-date window its neighbouring hardware anchors leave open. Hardware entries are anchors and are never constrained, so a capture can always overrule the ordering assumption. Release dates are a test-local map; adding a FamilyID now means stating when the device shipped.
3. Direction of risk — no inferred entry may name a non-`syncable` generation.
Plus: every entry carries evidence + non-empty source; the pre-existing no-touch / no-classic_1g-2g / no-video_5_5g structural tests, re-expressed over the new shape.

**Removed** 4 (photo), 5 (mini_1g), 7 (classic_6g), 8 (nano_1g), 24 (nano_6g) — each contradicts the anchor chronology, so the *number* is wrong even where the generation is real; a misplaced value is counter-evidence, not weak evidence. Also removed 13 (duplicate nano_3g): hardware puts nano_3g at 12 on two units, and 13 falls in the window where the classic 6G would land, so the guess could shadow a real device. All six now fail closed with the honest unknown-model error. Surviving inferred: 1, 2, 14, 16, 17 — all chronologically consistent and all naming syncable generations.

**Test contract renegotiated.** The five "(research)" value pins (1, 5, 7, 14, 24) are gone as truth assertions — three named values that no longer exist, and pinning 1/14 asserted an unverified guess is correct, which is the habit that froze the original table. Replaced by: a fail-closed pin on 4/5/7/8/24 and on 13 (behaviour we do stand behind), a `lookupFamilyIdEntry` test that 16 is labelled `inferred` (pins the *label*, not the truth), and the three invariants. Hardware pins (3, 6, 9, 12, 15, 18, 130, 132, 133) all kept.

**Open question recorded in code, not acted on:** entries 1 (classic_3g, 2003) and 2 (classic_4g, 2004) predate SysInfoExtended (~2005, Photo) by the same argument that keeps classic_1g/2g out of the table entirely — they may emit no FamilyID at all. Noted in each `source` string; left in place because removing them exceeds the evidence this task gathered.

Drive-by: three folklore `familyId` values in `capabilities.test.ts` firmware-overlay fixtures (nano_4g 17, classic_6g 19, nano_2g 22) corrected to 15 / 14 / 9. `documents/test-devices.md` reference to the old constant name updated.

Changeset `.changeset/family-id-provenance.md` — minor for `@podkit/devices-ipod` (clean API break, no deprecation cycle), patch for `podkit` / `@podkit/core` (no API change; behaviour change is six unidentifiable-anyway FamilyIDs now failing closed).

Gates: `bun run typecheck` 36/36 ✓; `bun run test:unit --filter @podkit/devices-ipod` 401 pass / 0 fail ✓; `bun run test:unit --filter @podkit/core` 3428 pass / 0 fail ✓; `bunx oxlint packages/devices-ipod` 0 errors ✓. Repo-wide `bun run lint` reports one pre-existing unused-var in `packages/podkit-cli/src/commands/sync.ts:917` from concurrent work in another package — not from this change.

The invariant proved itself on its first real entry. FamilyID 17 was corrected to `nano_6g` from hardware on 2026-08-18; `nano_6g` is a read-only generation, so had that been added as an `inferred` guess the syncable-only rule would have rejected it at commit time. It passes because it is hardware-attested — exactly the intended asymmetry.
<!-- SECTION:NOTES:END -->
