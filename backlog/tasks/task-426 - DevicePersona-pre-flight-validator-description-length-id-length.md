---
id: TASK-426
title: 'DevicePersona: pre-flight validator (description length + id length)'
status: Done
assignee: []
created_date: '2026-06-14 07:38'
updated_date: '2026-06-15 10:26'
labels:
  - testing
  - tier-3
  - developer-experience
  - quality-of-life
milestone: m-19
dependencies: []
references:
  - documents/architecture/testing/vm-testing.md
  - test-packages/device-testing/src/personas/index.ts
  - test-packages/device-testing/src/personas/types.ts
  - tools/device-testing/dummy-hcd/src/gadget.ts
priority: low
ordinal: 141000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

The Tier-3 harness has two persona-shape constraints that today fail at runtime with cryptic errors:

1. **USB string descriptor `bLength` cap.** Persona `description` is written to `configs/c.1/strings/0x409/configuration` (configfs). Anything over ~120 UTF-16 code units overflows the `u8` length field, kernel returns `EOVERFLOW`, daemon restart-loops, test times out with a misleading "is the dummy-hcd-daemon binding mass-storage correctly?" message.
2. **configfs FunctionFS path cap.** The path `/sys/kernel/config/usb_gadget/podkit-<personaId>/functions/ffs.podkit-<personaId>` has a ~40-byte segment cap. Personas with ids over ~32 chars trigger `ENAMETOOLONG` from `mkdir`, daemon restart-loops, same misleading timeout.

Both bit a recent persona author (TASK-350 spent significant time tracking these down with sub-agents). Adding a pre-flight validator at registry load time would surface the same information up-front with a clear error.

## What

Validate at registry load time (i.e. when `personas/index.ts` is imported and the `personas` Map is built):

- `persona.description` byte length when UTF-16-LE encoded is ≤ 252 bytes (`bLength` u8 minus 2-byte header, leaving room for trailing data).
- `persona.id` length is ≤ 32 ASCII chars (so `ffs.podkit-<id>` stays ≤ 40 bytes).
- `persona.id` matches `/^[a-z0-9-]+$/` (configfs path safety).

Plus a third nice-to-have:

- Every `initialContent[].sourceFixture` that begins with `./` (i.e. the convention is "lives in raw/") actually resolves — typo catches.

Validation failures should throw at module load with a descriptive error naming the persona and the constraint it violated.

## Where

- `test-packages/device-testing/src/personas/index.ts` — add a `validatePersona(p: DevicePersona): void` call inside the Map build loop, before `personas.set(p.id, p)`.
- The validator itself can live in `personas/validator.ts` (new file) so the rule set is grep-able.

## Out of scope

- Validating at TypeScript build time (would require a more sophisticated type-level constraint; runtime validation gives the same coverage with simpler code).
- Validating `partitionLayout` consistency against the synthesised backing-file recipe (separate concern, deferred).

## References

- `documents/architecture/testing/vm-testing.md` §5.1, §5.2 — the constraints + symptoms.
- `tools/device-testing/dummy-hcd/src/gadget.ts:110` — where the description string is written.
- `tools/device-testing/dummy-hcd/src/gadget.ts:114` — where the configfs path mkdir is attempted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `personas/index.ts` import-time validation throws a descriptive error for any persona whose `description` would overflow the USB string descriptor `bLength` field
- [x] #2 `personas/index.ts` import-time validation throws for any persona whose `id` exceeds 32 ASCII chars or doesn't match `/^[a-z0-9-]+$/`
- [x] #3 Failure messages name the persona id (so the dev knows which to fix) and the constraint (so they know what to change)
- [x] #4 Existing personas all pass validation (no false positives on the current registry)
- [x] #5 Unit tests at `personas/validator.test.ts` cover at least: too-long description, too-long id, illegal chars in id, valid persona shape
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Landed in commit 6047f465 (`test(personas): load-time validator for description/id/sourceFixture constraints`).

- `test-packages/device-testing/src/personas/validator.ts` — pure validator: `validateDescription` (UTF-16-LE ≤ 252 bytes), `validateId` (≤ 32 chars + `/^[a-z0-9-]+$/`), `validateInitialContentPaths` (no `..`, non-empty); failure messages name the persona id + cite the relevant `documents/architecture/testing/vm-testing.md` section.
- `test-packages/device-testing/src/personas/validator.test.ts` — unit coverage for too-long description, too-long id, illegal id chars, valid persona shape, sourceFixture edge cases.
- Wired into `personas/index.ts` Map build loop; existing registry passes (no false positives).
<!-- SECTION:FINAL_SUMMARY:END -->
