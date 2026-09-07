---
id: TASK-492
title: Make container runtime pluggable and container/substrate cells skip loudly
status: To Do
assignee: []
created_date: '2026-09-07 23:35'
labels:
  - testing
  - infrastructure
dependencies: []
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - docs/architecture/testing/taxonomy.md
priority: high
type: enhancement
ordinal: 271000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 1 of ADR-028 — the quick wins that need no new infrastructure.

Two independent problems, both small, both blocking a Linux dev box from having a useful inner loop:

**1. The container runtime is a hardcoded string.** `test:e2e:docker` (the `docker-source` surface) needs exactly one unprivileged, digest-pinned Navidrome container with a bind mount and a published port — a workload rootless Podman runs unmodified. The only blocker is the literal `'docker'` at four call sites with no env override:

- `test-packages/e2e-tests/src/docker/container-manager.ts:33` — `spawn('docker', args)`
- `test-packages/e2e-tests/src/docker/container-registry.ts:21` — duplicated private copy of the same helper
- `test-packages/e2e-tests/src/docker/container.ts:50` — `execSync(\`docker restart ...\`)`
- `test-packages/e2e-tests/src/docker-loopback/harness.ts:34` — `spawn('docker', ['exec', ...])`

Introduce `PODKIT_CONTAINER_RUNTIME` (default `docker`). Consider de-duplicating the two copies of the spawn helper while here.

**2. Missing infrastructure reports as failure, not skip.** Every `docker-source` test throws in `beforeAll` (e.g. `subsonic-sync.test.ts:35`, `device-add.test.ts:77`) — there is no `describe.skipIf` anywhere in the suite. `preflight.ts:116-120` does the same for the substrate, with `process.exit(1)`. So a machine without Docker reports four false failures where it should report skips.

Per ADR-028 §5: skip loudly with a reason, name the skipped cells in the gate summary, and have `quality` exit **non-zero**. A green gate that silently tested four of six surfaces is worse than no gate.

**Note the split by privilege, not by name:** `docker-source` is unprivileged and stays local. `docker-loopback` runs `--privileged` and `mknod`s 64 loop devices (`docker-loopback/harness.ts:62-80`) — it is out of scope here and goes to the substrate.

**Unverified assumption to prove first:** rootless Podman is expected to work on an unprivileged LXC via native overlay-in-userns (userns enabled, `/etc/subuid` populated, `overlay` in `/proc/filesystems`), but `/dev/fuse` is absent so fuse-overlayfs is unavailable. Prove this before relying on the local `docker-source` cell.

Incidental drift to fix while here: `orphan-cleaner.ts:126` and `preload.ts:29` tell users to run `bun run cleanup:docker`, which does not exist in any package.json. The real scripts are `cleanup` / `cleanup:force` / `cleanup:list`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Rootless Podman verified working on the LXC (or the assumption disproven and recorded in ADR-028)
- [ ] #2 PODKIT_CONTAINER_RUNTIME env var honoured at all four call sites, defaulting to 'docker'
- [ ] #3 The two duplicated docker-spawn helpers are reconciled into one
- [ ] #4 test:e2e:docker passes on Linux using rootless Podman
- [ ] #5 Cells with an unavailable runtime or substrate report as skipped with a stated reason, not as failures
- [ ] #6 The quality gate summary names every skipped cell
- [ ] #7 quality exits non-zero when any cell was skipped
- [ ] #8 cleanup:docker references corrected to the real script names
<!-- AC:END -->
