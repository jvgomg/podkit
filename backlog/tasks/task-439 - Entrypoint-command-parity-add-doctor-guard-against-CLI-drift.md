---
id: TASK-439
title: 'Entrypoint command-parity: add doctor + guard against CLI drift'
status: Done
assignee: []
created_date: '2026-06-27 19:03'
updated_date: '2026-06-27 22:49'
labels:
  - docker
  - entrypoint
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-docker/entrypoint.sh
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`docker run podkit doctor` currently falls through to the raw-shell branch and fails because `doctor` was never added to the entrypoint's `PODKIT_COMMANDS` list. Fix the immediate blocker, then make command-parity robust so future CLI commands don't silently break in the image.

Per doc-052: keep the entrypoint bash thin — the parity check should validate against the CLI's actual known commands rather than a hand-maintained string that drifts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `docker run podkit doctor` runs the diagnostics (does not fall through to raw-shell)
- [x] #2 Entrypoint recognises every current podkit subcommand
- [x] #3 Command list is derived from / validated against the CLI rather than hand-maintained, so a newly-added CLI command cannot silently break the image
- [x] #4 Covered by the entrypoint bats suite (see testing task)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Entrypoint command-parity made drift-proof.

CLI: added pure `listTopLevelCommandNames(program)` + a hidden `__complete commands` subcommand in packages/podkit-cli/src/commands/completions.ts that prints the live Commander command tree (names + aliases, excluding `__complete`/`help`). Unit-tested (pure fn) + a subprocess test pinning the real CLI emits `doctor` and hides internals.

Entrypoint (packages/podkit-docker/entrypoint.sh): PODKIT_COMMANDS now derived at runtime via `podkit __complete commands` (+ `daemon` pseudo-command appended). `doctor` (and any future command) routes automatically — fixes the `docker run podkit doctor` -> raw-shell blocker (AC#1), recognises every subcommand (AC#2), derived-from-CLI not hand-maintained (AC#3).

Docs: agents/docker.md updated (the 'add new commands to PODKIT_COMMANDS' instruction was now false).

Sonnet review applied: (BLOCKER) `set -e` + failing/empty `$(...)` would abort the container or silently misroute every subcommand through 2>/dev/null -> fixed with `|| true`, empty-guard, a stderr warning, and a built-in fallback list (incl. doctor, so the fix holds even degraded). (should-fix) `__complete commands` action now fails loudly (stderr + exitCode 1) instead of silent return on null parent. (nit) extractCommandTree also filters `help` for parity with listTopLevelCommandNames. (nit) added the real-program subprocess pin. Verified degraded path survives set -e and engages fallback.

AC#4 (entrypoint bats suite): owned by TASK-448 (Tier-2). Left unchecked here — the CLI-side derivation logic is unit-tested; the bash routing is bats territory per doc-053.

Verification: podkit lint + typecheck clean; shellcheck entrypoint.sh OK; podkit test:unit 1917 pass / 1 pre-existing unrelated fail (playlist heading annotation).

AC#4 now satisfied: the entrypoint bats suite (TASK-448, packages/podkit-docker/test/entrypoint.bats) covers command routing + command-parity (incl. the doctor regression). TASK-448 also fixed a related entrypoint bug found while testing: combined-form `--device=`/`--path=` flag detection.
<!-- SECTION:NOTES:END -->
