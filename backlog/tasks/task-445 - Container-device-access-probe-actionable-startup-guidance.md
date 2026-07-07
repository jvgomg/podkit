---
id: TASK-445
title: Container device-access probe + actionable startup guidance
status: Done
assignee: []
created_date: '2026-06-27 19:04'
updated_date: '2026-07-07 22:56'
labels:
  - docker
  - entrypoint
  - ux
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-docker/entrypoint.sh
modified_files:
  - packages/podkit-cli/src/commands/container-probe.ts
  - packages/podkit-cli/src/commands/container-probe.test.ts
  - packages/podkit-cli/src/commands/completions.ts
  - packages/podkit-cli/src/commands/completions.test.ts
  - packages/podkit-cli/src/main.ts
  - packages/podkit-docker/entrypoint.sh
  - packages/podkit-docker/test/entrypoint.bats
  - oxlint.json
  - docs/getting-started/docker-daemon.md
  - .changeset/docker-device-access-probe.md
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Users hit confusing failures when the container lacks the device access their chosen path needs. Add a startup **device-access probe**: a pure module that, given the container's filesystem/proc view, reports whether `/ipod` is mounted, whether `/dev/bus/usb` is present, whether `/dev/sg*` is present, and emits actionable guidance ("no iPod mounted at /ipod — mount it on the host and bind it", "no USB passthrough — one-time `device add` setup unavailable", etc.).

Keep the entrypoint bash thin; put the logic in a unit-testable module invoked from it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pure device-access probe: (fs/proc view) -> access report + guidance, unit-tested in isolation
- [x] #2 Entrypoint surfaces the report at startup with actionable guidance per missing access
- [x] #3 Guidance distinguishes the path-baseline case from the USB-setup case
- [x] #4 Does not block startup — informational, not fatal
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Handoff note (from TASK-447): TASK-447 (Tier-1 tests) depends on this. Build the container device-access probe as a pure, table-tested module (given a filesystem/proc view -> reports /ipod mounted? /dev/bus/usb? /dev/sg*? + guidance), with external-behavior tests — that doubles as the Tier-1 unit test for this module (447 AC#2/#3). The entrypoint already derives its command list from the CLI (TASK-439); the probe is the startup device-access guidance piece.

Implemented (TDD). New hidden CLI command `podkit __container-probe` (packages/podkit-cli/src/commands/container-probe.ts): pure formatDeviceAccessReport(view) + pure isMountPoint(procMounts, path) with octal-escape decoding and exact-match semantics, 11 table tests — reports /ipod mount state, /dev/bus/usb, /dev/sg* with per-item guidance; path-baseline explicitly distinguished from one-time USB setup (missing USB copy says 'not needed for path-based sync'). Impure collector fences every read (/proc/mounts, /dev) so failures degrade instead of crash; command always exits 0 (AC#4 by construction). Logic lives in the CLI where it's unit-testable; entrypoint is a thin `podkit __container-probe 2>/dev/null || true` caller after the banner.

Internal-command hygiene: preAction config-load skip, listTopLevelCommandNames, and the completions tree filter all changed from `=== '__complete'` to a `__`-prefix rule, so the probe never leaks into entrypoint routing, shell completions, or config loading; the real-CLI subprocess parity test now pins `__container-probe` exclusion too. oxlint no-console override extended to container-probe.ts (raw stdout is the contract, same as completions.ts).

MAJOR DRIVE-BY FIX — the Tier-2 bats suite (TASK-448) was partly vacuous: on macOS bash 3.2 a failing `[[ ]]` compound command does not trigger bats' errexit unless it is the test's LAST command, so every intermediate `[[ "$output" == … ]]` assertion was a silent no-op (discovered when my new probe tests passed before the entrypoint change existed). Converted all substring assertions to assert_contains/assert_not_contains helper functions (function-call failures DO trigger errexit on bash 3.2; helpers also print the haystack on failure). Reviewer verified the remaining constructs ([ ], local-then-assign, the `|| { …; false; }` pattern) are errexit-safe. No latent failures surfaced once assertions became real. 3 new probe bats tests; 20/20 green.

Docs: docker-daemon.md Troubleshooting now leads with the startup Device access report. Changeset: @podkit/docker minor + podkit patch. Sonnet review: no blockers; applied the subprocess-test exclusion pin and the spurious-blank-line entrypoint nit; declined ordering assertion + --ipod-path wiring test (noted as low-risk). Verification: 1946 CLI tests, 20 bats, typecheck + root lint green.
<!-- SECTION:NOTES:END -->
