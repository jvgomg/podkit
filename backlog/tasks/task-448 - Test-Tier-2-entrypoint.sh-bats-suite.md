---
id: TASK-448
title: 'Test Tier 2: entrypoint.sh bats suite'
status: Done
assignee: []
created_date: '2026-06-27 19:05'
updated_date: '2026-06-27 22:49'
labels:
  - docker
  - entrypoint
  - testing
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
  - packages/podkit-docker/entrypoint.sh
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tier 2 of the docker testing strategy. Shell-level `bats` tests of `entrypoint.sh`: command routing (sync/daemon/raw/known-subcommand), command-parity (every CLI command recognised — would have caught the `doctor` blocker), PUID/PGID user/group creation and ownership, `--device /ipod` injection for sync, `--path /config/config.toml` injection for init, su-exec privilege drop for one-shot vs root for daemon. No device, no real sync.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 bats suite covers command routing including the known-subcommand and raw-passthrough branches
- [x] #2 Command-parity assertion fails if a CLI command is unrecognised by the entrypoint
- [x] #3 PUID/PGID user/group creation + ownership asserted
- [x] #4 `--device /ipod` and init `--path` injection asserted
- [x] #5 su-exec drop (one-shot) vs root (daemon) asserted
- [x] #6 Suite is runnable locally via a documented command
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Tier-2 bats suite at packages/podkit-docker/test/entrypoint.bats (17 tests). Stubs podkit/su-exec/podkit-daemon/groupadd/useradd/chown into BATS_TEST_TMPDIR on PATH; stubs echo argv so the entrypoint's final `exec` target (and PUID/PGID calls) are observable — no container, no real sync.

Coverage: routing (known-subcommand/raw-passthrough/`podkit` literal) [AC#1]; command-parity derived from `podkit __complete commands` + explicit doctor regression + degraded-fallback path [AC#2]; PUID/PGID group/user creation + /config chown + 1000 defaults [AC#3]; --device /ipod and init --path /config/config.toml injection incl. explicit, -d shorthand, and --flag=value combined forms [AC#4]; su-exec drop (one-shot) vs root podkit-daemon (daemon) [AC#5]. Runnable via `bun run test --filter @podkit/docker` (also in `bun run quality` via turbo) or `cd packages/podkit-docker && bun run test`; bats is a @podkit/docker devDependency [AC#6]. Documented in agents/docker.md.

Proved the suite catches the original blocker: with a podkit stub that omits doctor from `__complete commands`, the entrypoint routes doctor to raw (test 5 fails).

Sonnet review applied: added `[ "$status" -eq 0 ]` to every behavioural test (was missing in ~6, a false-green risk); added positive su-exec asserts to the override tests; `unset PUID PGID` in the defaults test; degraded-fallback test; `-d` and `--flag=value` combined-form tests. Removed the redundant `test:entrypoint` script.

Review #5 surfaced a REAL entrypoint bug, fixed here: `--device=value` / `--path=value` combined forms were not detected, so the Docker defaults (`--device /ipod` / `--path /config/config.toml`) were wrongly appended on top. Fixed the `case` patterns in entrypoint.sh + pinned with tests 12/15. Changeset added (@podkit/docker patch) covering the doctor-routing drift-proofing and the combined-flag fix.

Verification: 17/17 bats pass directly and via `bunx turbo run test --filter=@podkit/docker`; shellcheck entrypoint.sh OK.
<!-- SECTION:NOTES:END -->
