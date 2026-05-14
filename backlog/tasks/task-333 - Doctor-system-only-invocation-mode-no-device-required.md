---
id: TASK-333
title: 'Doctor: system-only invocation mode (no device required)'
status: To Do
assignee: []
created_date: '2026-05-14 19:21'
labels:
  - doctor
  - cli
  - vm-coverage
milestone: m-19
dependencies: []
priority: high
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a CLI surface to `podkit doctor` that runs **only** the system-scope checks, without requiring a registered device. Today doctor always tries to resolve a device and exits with `DEVICE_NOT_RESOLVED` when none is configured, which blocks any system-scope assertion in Tier-3 tests that has not first run `podkit device add`.

**Surface (proposed; tweak in review):**

- `--scope <system|device|all>` (default `all`) — chooses which check groups run
  - `system` — runs only system-scope checks (FFmpeg, codec encoders, video encoder, libgpod runtime, inquiry-methods, udev rule on Linux). No device required.
  - `device` — runs only device-scope checks. Requires `-d`.
  - `all` — current behaviour.
- Equivalent shorthand: a `--no-device` flag could be considered as an alternative; pick whichever fits Commander's existing flag style best.

When `--scope system` is in effect:
- doctor skips device resolution entirely
- doctor emits `checks[]` containing only `scope === 'system'` entries
- `--json` (global) produces the same overall envelope as today (`{ healthy, readiness?, checks[], ... }`) but with `readiness` omitted or marked `skipped` because there is no device to read
- exit code follows TASK-308 semantics applied to the system checks only

**Why this matters:**
- Tier-3 baseline tests (TASK-322.06) want to assert system-scope behaviour against a `SystemState` snapshot without first synthesising a device and running `device add`. The current flag set forces test code to either fake a device or run no doctor assertions at all.
- TASK-307 (Doctor CLI flag matrix) names `--no-system` but has no inverse. This adds the symmetry.
- Outside testing, a user running `podkit doctor --scope system` on a fresh machine before plugging an iPod in is also useful diagnostically.

**Out of scope:** changing the default behaviour, changing the `--no-system` flag, restructuring the doctor report. This is a purely additive flag.

**References:**
- `packages/podkit-cli/src/commands/doctor.ts` — current option set (lines ~230-236)
- `packages/device-testing/src/system-states/` — fixtures that consume the new mode
- TASK-307 (Doctor CLI flag matrix) — extend its AC set to cover this flag once it lands
- TASK-308 (Doctor exit-code semantics) — applies to the new mode
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 --scope <system|device|all> flag added to doctor command; default is 'all' (current behaviour)
- [ ] #2 --scope system runs only system-scope checks without requiring a device (no DEVICE_NOT_RESOLVED error)
- [ ] #3 --scope system + --json emits valid JSON containing only system-scope checks[] entries and an overall healthy boolean
- [ ] #4 --scope device requires -d/--device; error message matches the existing 'device required' style
- [ ] #5 --scope all (default) behaviour is byte-identical to today's output for the same fixture
- [ ] #6 Unit tests cover all three --scope values × --json on/off × --no-system on/off, asserting the right checks[] subset is run
- [ ] #7 TASK-307 acceptance criteria are extended in the same PR (or a follow-up commit) to cover the new flag
- [ ] #8 Doctor exit code under --scope system follows TASK-308 semantics applied to the system-check subset (warn-counts-as-unhealthy decision applies consistently)
- [ ] #9 podkit doctor --scope system --json on a freshly-booted machine with no configured device exits 0 and emits a doctor report with all system checks; documented in agents/testing.md or equivalent
<!-- AC:END -->
