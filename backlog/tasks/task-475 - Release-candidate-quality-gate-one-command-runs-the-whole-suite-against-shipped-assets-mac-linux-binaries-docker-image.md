---
id: TASK-475
title: >-
  Release-candidate quality gate: one command runs the whole suite against
  shipped assets (mac + linux binaries + docker image)
status: Done
assignee: []
created_date: '2026-08-06 09:51'
updated_date: '2026-08-06 16:24'
labels:
  - testing
  - ci
  - docker
  - vm
  - release
milestone: m-22
dependencies:
  - TASK-463
references:
  - test-packages/e2e-shared/src/cli-runner.ts
  - turbo.json
  - package.json
  - documents/architecture/dev-builds.md
  - adr/adr-021-cli-bun-binary-distribution.md
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
modified_files:
  - test-packages/e2e-shared/src/cli-runner.ts
  - test-packages/e2e-shared/src/cli-runner.test.ts
  - test-packages/e2e-shared/src/index.ts
  - test-packages/e2e-shared/package.json
  - turbo.json
  - package.json
  - agents/testing.md
ordinal: 235000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Before shipping, we want ONE command that runs the whole quality suite against the *actual pre-release assets about to be released* — not fresh dev proxies. Surfaced while landing TASK-463 (docker `:edge` pull gate): the default `quality` (`turbo run qa`) does NOT exercise every shipped artefact:
- **mac binary**: the host e2e's `'production'` build runs the BUNDLE proxy (`dist/main.js` under bun), NOT the shipped Bun `--compile` binary (`bin/podkit`) — see cli-runner.ts + ADR-021. So `quality` never drove the real mac binary.
- **docker image**: `docker-dist` + `docker-loopback` are excluded from `qa` entirely.
- **linux musl binary**: `test:vm` already runs the shipped musl `--compile` binary — this one was fine.

## What landed (this task)

1. **`PODKIT_CLI_BINARY` override** (cli-runner.ts): when set, the host e2e `'production'` build resolves to that path and is invoked DIRECTLY (like `debug`) — pointing the whole host suite at the real compiled mac binary or a fetched pre-release tarball. Mirrors the VM's `PODKIT_LINUX_*_BINARY` overrides. Default (unset) unchanged. Exported `CLI_BINARY_ENV`.
2. **`quality:rc` script**: `PODKIT_CLI_BINARY="$PWD/packages/podkit-cli/bin/podkit" turbo run qa test:e2e:docker-dist test:e2e:docker-loopback` — one command covering mac binary (host e2e, direct) + linux musl (VM) + docker image (both surfaces) + unit/integration. Prefix `PODKIT_DOCKER_DIST_IMAGE=ghcr.io/jvgomg/podkit:edge` to gate docker against the real pushed image (TASK-463).
3. **turbo passthrough** (turbo.json globalPassThroughEnv): added `PODKIT_DOCKER_DIST_IMAGE`, `PODKIT_LINUX_BINARY`, `PODKIT_LINUX_MUSL_BINARY`, `PODKIT_DAEMON_LINUX_BINARY`, `PODKIT_DAEMON_LINUX_MUSL_BINARY`, `PODKIT_CLI_BINARY`. Without this, turbo's strict env-filtering silently dropped these overrides and every surface fell back to a local build (this was a real bug — the TASK-463 docker pull path was a no-op through the turbo script until fixed).

## Deferred / future (not in this task)

- **True CI-byte fidelity**: `quality:rc` currently drives locally-built assets (same release recipe: `compile` for mac, musl-builder VM for linux, local docker build or `:edge`). A stricter RC gate would FETCH the exact CI artifacts (`gh run download` from the release/edge build, or the GitHub release tarballs) and point the overrides at those. Design the fetch + a `quality:rc:ci` variant.
- **amd64 / cross-arch**: `:edge` is arm64-only; a full multi-arch RC gate needs the full build-platform matrix.
- Running the FULL `quality:rc` end-to-end is long (VM + docker builds, ~15 min) — validate + tune in CI-less local runs; consider a lighter `quality:rc:fast` subset.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 PODKIT_CLI_BINARY override in cli-runner points the host e2e at a standalone compiled binary, invoked directly; default (unset) behaviour unchanged; unit-tested + proven live against bin/podkit
- [x] #2 quality:rc runs qa + docker-dist + docker-loopback in one command, covering mac binary (host e2e) + linux musl (VM) + docker image
- [x] #3 turbo globalPassThroughEnv forwards the docker-image + binary override envs so the switches actually reach the test processes (was silently filtered)
- [x] #4 Documented: quality:rc + the PODKIT_CLI_BINARY / PODKIT_DOCKER_DIST_IMAGE knobs (agents/testing.md or docker.md)
- [x] #5 Full quality:rc run validated green end-to-end (deferred to a real long run — currently statically validated + per-surface proven)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed + verified (2026-08-06):
- `PODKIT_CLI_BINARY` override in cli-runner.ts (getCliPath resolves override → direct invocation via `cliRunsDirectly`); exported `CLI_BINARY_ENV`. Unit test `cli-runner.test.ts` 6/6 + new `test:unit` lane on @podkit/e2e-shared. PROVEN LIVE: `PODKIT_CLI_BINARY=$PWD/packages/podkit-cli/bin/podkit bun test cli-overrides.test.ts` → 10/10 host e2e pass against the real compiled mac binary (Mach-O arm64).
- `quality:rc` root script. DAG dry-run confirmed it resolves to: compile, test:e2e (host/mac), test:vm+vm:install (linux musl), test:e2e:docker-dist + test:e2e:docker-loopback (image), test:unit/integration.
- turbo.json globalPassThroughEnv extended (the passthrough BUG fix): without it, `PODKIT_DOCKER_DIST_IMAGE` was silently filtered and TASK-463's docker pull path was a no-op through the turbo script — caught by inspecting `nerdctl images` (VM had the stale local `podkit:docker-dist`, not `:edge`). After the fix, re-ran and `ghcr.io/jvgomg/podkit:edge` was pulled + all 6 docker-dist tests passed against it.
- typecheck 15/15; oxlint 0/0 on all changed files; docs in agents/testing.md.
AC#5 (full quality:rc green end-to-end) deferred — it's a ~15min VM+docker run; validated statically + per-surface.

First full `quality:rc` runs (2026-08-06) — the gate did its job, catching TWO issues it alone could surface (both fixed):
1. **Harness bug (my own incomplete change).** `graceful-shutdown.test.ts` has a bespoke `spawnCli` (needs the raw ChildProcess for signal delivery) that hardcoded `spawn('bun', [cliPath, ...])`. With `PODKIT_CLI_BINARY` pointing at the compiled `bin/podkit`, it ran `bun bin/podkit …` → a compiled binary mis-run as a bun script → exit 1 (expected 130). Fix: extracted the direct-vs-`bun` decision into an exported `cliSpawnArgv(binary, args)`; both `runCli` and the bespoke spawner use it now. Re-verified green against BOTH the compiled binary and the default bundle.
2. **RC-gate composition bug.** `quality:rc` listed `test:vm` (inside `qa`) and `test:e2e:docker-dist` as unordered top-level tasks → turbo ran them CONCURRENTLY against the single shared `podkit-device-harness` VM → gadget/mount state collision (`gpod-tool init` fails creating `iPod_Control` on the drain mount; GLib domain!=0). docker-dist passes 6/6 standalone but 4/6 when contended. Fix: `quality:rc` now runs two turbo phases — `turbo run qa && turbo run test:e2e:docker-dist test:e2e:docker-loopback` — so the docker phase waits for `qa` to release the VM. Documented the serialization rationale in agents/testing.md. (Latent hazard noted: test:vm + docker-dist must never run concurrently against the one VM.)
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
RC quality gate delivered + proven. `bun run quality:rc` runs the whole suite against the actual shipped assets in one command — mac `--compile` binary (host e2e, via the new `PODKIT_CLI_BINARY` direct-invocation override), linux musl binary (test:vm), and the docker image (docker-dist + docker-loopback), plus unit/integration. Prefix `PODKIT_DOCKER_DIST_IMAGE=ghcr.io/jvgomg/podkit:edge` to gate docker against the real GHA-built image (TASK-463).

Enablers: `PODKIT_CLI_BINARY` + shared `cliSpawnArgv` invocation helper (cli-runner), turbo `globalPassThroughEnv` for the image/binary override envs, and a two-phase `quality:rc` (`qa` → docker surfaces) that serializes the VM-bound suites.

The gate immediately earned its keep, catching two false-green classes on its first runs (both fixed): (1) a bespoke signal-test spawner that mis-ran the compiled binary as a bun script; (2) `test:vm` + `docker-dist` colliding on the shared harness VM when run concurrently. Final full run against `:edge`: phase-1 qa 94/94, phase-2 docker 25/25; host e2e 37/0, test:vm 38/0, docker-dist 6/0, docker-loopback 3/0.

Deferred (future task): true CI-byte fidelity (fetch the exact release/edge artifacts rather than local-recipe builds) and amd64/cross-arch coverage.
<!-- SECTION:FINAL_SUMMARY:END -->
