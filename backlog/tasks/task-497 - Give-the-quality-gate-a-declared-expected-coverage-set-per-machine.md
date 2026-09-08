---
id: TASK-497
title: Give the quality gate a declared expected-coverage set per machine
status: To Do
assignee: []
created_date: '2026-09-08 18:03'
labels:
  - testing
  - infrastructure
dependencies: []
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - docs/architecture/testing/taxonomy.md
priority: medium
type: enhancement
ordinal: 276000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced while designing task-495. The gate's coverage contract has no notion of *which* cells a given machine is responsible for, so it cannot be used anywhere except the one machine that can run everything.

task-492 gave `bun run quality` a coverage contract: `test-packages/device-testing/scripts/run-mirror-body.ts` prints a capabilities report and returns `EXIT_INCOMPLETE = 2` when every suite passed but some surface was never covered. That is correct on a machine expected to cover everything.

It is wrong everywhere else. On `ubuntu-latest` there is no device substrate and `usb-synth` is explicitly deferred by ADR-028 §6, so `quality` is structurally a permanent exit 2. The Linux dev host (`docs/environments/linux-dev-host.md`) is in the same position — it deliberately runs only Unit, Integration, `host-binary`·`local-dir`·`dir` and `host-binary`·`docker-sidecar`·`dir`.

This forced task-495 to invoke the individual turbo tasks directly rather than reuse the gate. That is a workaround, and it means CI re-implements the gate's task list instead of sharing it — the two will drift.

**The fix:** let a machine *declare* the cells it owns, and fire `EXIT_INCOMPLETE` only when a **declared** cell was skipped. An undeclared cell is not a gap, it is someone else's job.

The two rejected alternatives, recorded so they are not revisited blindly:

- **CI swallows exit 2** — also swallows a genuinely-missing `docker-sidecar` cell, which is the exact silent-skip failure ADR-028 §5 exists to prevent.
- **CI runs the turbo tasks directly** — what task-495 does. Fine as an interim, but the task list is now duplicated between `turbo.json`'s `qa:*` tiering and the CI workflow.

Open design questions: where the declaration lives (a per-machine config file, an env var, a named profile in the repo); whether the substrate/container capability probes in `test-packages/device-testing/src/capabilities.ts` should resolve the declaration or just report against it; and whether CI should then simply call `quality` with a profile.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A machine can declare which taxonomy cells it is responsible for covering
- [ ] #2 EXIT_INCOMPLETE fires only when a declared cell was skipped, never for an undeclared one
- [ ] #3 A skipped undeclared cell is still named in the gate summary, distinguishable from a declared one
- [ ] #4 The Linux dev host and a CI runner can both run the gate and exit 0 when their declared cells pass
- [ ] #5 CI no longer needs to re-implement the gate's task list
<!-- AC:END -->
