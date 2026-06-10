---
id: TASK-360.04
title: Block device add on empty identity; require --force or --no-firmware-inquiry
status: To Do
assignee: []
created_date: '2026-05-28 21:28'
updated_date: '2026-06-09 22:51'
labels:
  - device
  - cli
  - ux
dependencies: []
references:
  - test-packages/e2e-tests/src/commands/device.test.ts
parent_task_id: TASK-360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`commands/device.test.ts:158-191` documents that `device add` silently persists when both SysInfo files are absent and USB is unreachable (firmware inquiry lands in `unwritable` state). A device persisted with empty identity may behave unexpectedly in later commands.

The explicit opt-out (`--no-firmware-inquiry`) already exists for users who knowingly skip identity capture (`packages/podkit-cli/src/commands/device/add.ts:115-121`).

## Decision

Block `device add` by default when identity is empty. Users who explicitly want to proceed must pass `--force` or the existing `--no-firmware-inquiry`.

## References

- test-packages/e2e-tests/src/commands/device.test.ts:158-191
- packages/podkit-cli/src/commands/device/add.ts:115-121
- packages/podkit-core/src/device/ipod-identity.ts:156-164 (firmwareInquiry: 'unwritable')
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `device add` refuses to persist when firmware inquiry returns `unwritable` AND no identity cascade signal is available, unless `--force` or `--no-firmware-inquiry` is set
- [x] #2 Refusal message points to remediation: mount the device, check USB access, or pass `--no-firmware-inquiry` / `--force` to proceed anyway
- [x] #3 Add `--force` flag to `device add` (separate from `--no-firmware-inquiry`); document both in `--help` and shell completions
- [x] #4 Update `device.test.ts:158-191`: existing silent-persist case becomes a refusal assertion; add new case for `--force` proceeding with a warning; add case for `--no-firmware-inquiry` still proceeding (preserve existing behaviour)
- [x] #5 No regression in any device-add path that has even a partial identity (warning, not refusal, if cascade gives a partial result)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

### Predicate (single source of truth)
Added `isIdentityFullyEmpty(assessment, userType?)` and `summariseIdentitySignals(assessment, userType?)` to `packages/podkit-core/src/device/ipod-identity.ts`. Re-exported from `@podkit/core`. The predicate returns `true` only when **all** of:
- assessment is null OR `firmwareInquiry === 'unwritable'`
- no model resolved
- no classic SysInfo ModelNumStr on disk
- no USB fingerprint
- no `--type` flag

Partial cascades (any of those signals present) → `false` → device-add warns and proceeds.

### CLI wiring
- New `--force` flag on `device add` (declared via Commander, so shell completions pick it up automatically per `agents/shell-completions.md` — no separate completion files to edit).
- New `EMPTY_IDENTITY` code in `DeviceErrorCodes`.
- New `enforceIdentityGate(out, assessment, options, refusalPath)` helper in `add.ts` — invoked from both the `--path` branch and the scan branch right after `assessIdentity` returns. Refuses on fully-empty identity, warns on partial cascade, warn-and-proceeds when `--force` or `--no-firmware-inquiry` is set.
- Refusal message lists three remediations: re-mount + check USB, `--no-firmware-inquiry`, or `--force`.

### Tests
- Added 11 new unit tests in `packages/podkit-core/src/device/ipod-identity.test.ts` covering every branch of the predicate and the signal summary.
- Rewrote the existing `SysInfoExtended` e2e suite in `test-packages/e2e-tests/src/commands/device.test.ts`:
  - existing silent-persist case → now asserts exit 1 + refusal message + device NOT added
  - new `--force` case → exit 0 + warning + device added
  - new `--no-firmware-inquiry` case → exit 0 + device added (preserved behaviour)
  - new partial-cascade case (classic SysInfo present, SysInfoExtended removed) → exit 0 + "Partial device identity" warning + device added
- Updated two pre-existing `with uninitialized device` tests to pass `--force` (those test bare empty dirs which now legitimately trigger the block).

### Files modified
- `packages/podkit-core/src/device/ipod-identity.ts`
- `packages/podkit-core/src/device/index.ts`
- `packages/podkit-core/src/index.ts`
- `packages/podkit-core/src/device/ipod-identity.test.ts`
- `packages/podkit-cli/src/commands/device/add.ts`
- `packages/podkit-cli/src/commands/device/error-codes.ts`
- `packages/demo/src/mock-core.ts` (mock stubs for the new exports)
- `test-packages/e2e-tests/src/commands/device.test.ts`

### Quality gates
- `bun run test:unit` — green (1407 + 3130 tests across packages)
- `bun test test-packages/e2e-tests/src/commands/device.test.ts` — 34/34 green
- `bun run build` — green
- `bun run lint` — clean
- Pre-existing typecheck failure in `mock-core.check.ts` for `checkSourceFileValidity` is unrelated to this work (verified by stashing the mock-core changes).

### Notes
- The `--type ipod` (or any explicit `--type`) bypasses the block — explicit type assertion is treated as deliberate user consent on par with `--no-firmware-inquiry`. This means most existing unit tests in `device-add.unit.test.ts` (which all pass `type: 'ipod'`) are unaffected.
- Shell completions: per `agents/shell-completions.md` the generator walks the Commander tree at runtime, so adding `--force` via `.option()` exposes it for zsh + bash completions automatically. No static completion files to update.
<!-- SECTION:NOTES:END -->
