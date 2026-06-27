---
id: TASK-449
title: 'Test Tier 3: Docker image smoke test'
status: Done
assignee: []
created_date: '2026-06-27 19:05'
updated_date: '2026-06-27 23:21'
labels:
  - docker
  - testing
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tier 3 of the docker testing strategy. Build the image for the native arch and assert it boots and is internally consistent: `--version` works, `doctor` works (not just exists), command-parity holds against the running binary, ffmpeg present and runnable, both `podkit` and `podkit-daemon` binaries present and executable, entrypoint executable. Catches the entire "image drifted from the CLI" class. Local-only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Image builds for native arch within the test
- [x] #2 `--version` and `doctor` both succeed through the image
- [x] #3 Command-parity asserted against the running binary
- [x] #4 ffmpeg present and runnable; both binaries present and executable; entrypoint executable
- [x] #5 Runnable locally via a documented command
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Tier-3 image smoke at packages/podkit-docker/test/image-smoke.sh + Dockerfile.smoke. 8 assertions, all green.

Approach (per James's steer to the Lima harness): the shipped image copies CI-prebuilt musl binaries, not reproducible on macOS. So the smoke builds a REPRESENTATIVE glibc image: CLI binary via `@podkit/device-testing#build:linux-binary` (Lima builder, turbo-cached), daemon compiled in the same VM (build:linux-binary builds CLI only), on debian-bookworm-slim with gosu symlinked as su-exec. Tiny dedicated build context (no node_modules/.git). Documented caveat: not byte-identical to the Alpine/musl shipped image — full musl fidelity against a synthesized USB device is Tier-5/CI.

Assertions: --version through the image [AC#2]; doctor --help wired + `doctor --system-only --json` emits a real `checks` array + doctor routes through the entrypoint [AC#2]; `__complete commands` advertises doctor/sync/device — parity vs the running binary [AC#3]; ffmpeg runnable; podkit + podkit-daemon + entrypoint executable; daemon starts (run under `timeout 3`, expect 124) [AC#4]; image is built within the test [AC#1]. Runnable via `bun run test:smoke --filter @podkit/docker` (docker + limactl required; deliberately NOT in the quality gate — heavy/host-specific) [AC#5]. Documented in agents/docker.md.

Hit + fixed during impl: podkit-daemon has no --help → entered its poll loop and HUNG the container; now run under timeout expecting exit 124.

Sonnet review applied: (1) bash -c pipe assertions lacked pipefail → a non-zero `docker run` was masked by a matching grep; added `-o pipefail`. (2) The doctor assertion was a FALSE GREEN — `doctor --json` with no device errors DEVICE_NOT_RESOLVED and the loose grep matched "system" in the remediation text; switched to `doctor --system-only --json` + grep `"checks"`. (3) daemon binary was reused if present (stale-across-source risk) → now always rebuilt. (4) clarified the exit-124 comment (clean exit 0 is treated as failure by design). (5) added an EXIT trap to clean the staging context. (6) dropped a redundant bash -c wrapper.

No changeset: test-infra only, no distributed-package user-facing change. Verification: shellcheck image-smoke.sh OK; 8/8 smoke assertions pass; entrypoint bats still 17/17.
<!-- SECTION:NOTES:END -->
