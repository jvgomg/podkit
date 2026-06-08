---
id: TASK-411
title: Investigate docker buildx as ephemeral Linux prebuild builder (replace Lima)
status: To Do
assignee: []
created_date: '2026-06-08 07:22'
labels:
  - build
  - tech-debt
  - research
  - libgpod-node
  - infra
dependencies: []
references:
  - test-packages/device-testing/scripts/build-linux-prebuild.sh
  - test-packages/device-testing/lima/podkit-linux-builder.yaml
  - tools/prebuild/build-linux-glibc.sh
  - .github/workflows/prebuild.yml
priority: low
ordinal: 126000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-410 hardened the existing Lima-based `build:linux-prebuild` pipeline (VM-local rsync, pinned Node target, `node-gyp clean` not needed once the build tree is VM-local). That eliminated the observed stale-state failure class but did not change the *shape* of the pipeline:

- Lima VM `podkit-linux-builder` is long-lived and stateful (toolchain, static-deps cache, `~/.cache/podkit-static-deps`).
- Local dev path (`bunx turbo run @podkit/device-testing#build:linux-prebuild`) uses Lima.
- CI path (`.github/workflows/prebuild.yml`) uses `ubuntu-latest` runners directly (no Lima).
- Dev and CI invoke the same `tools/prebuild/build-linux-glibc.sh`, but the surrounding environment is two different machines.

Possible structural improvement: replace the Lima builder VM with an ephemeral `docker buildx` container build, pinned to a specific Debian image (e.g. `debian:12.10-slim`). Each build = fresh container = hermetic by construction = same path dev + CI.

## What to investigate

1. **Static-deps caching strategy under Docker.** The slow path is `tools/prebuild/build-static-deps.sh` (~10-15 min cold). Lima caches it under `$HOME/.cache/podkit-static-deps`. Under Docker, options:
   - Bake static deps into a base image, content-addressed by `sha256(build-static-deps.sh + version pins)`. Push to GHCR.
   - Use a buildx cache mount (`--cache-from`/`--cache-to`) for the static-deps stage.
   - Volume mount a host cache dir (simpler but less hermetic).
2. **Cross-arch coverage.** Lima today builds for the host's arch (x64 on Intel macs, arm64 on Apple Silicon). `docker buildx` natively supports `--platform linux/amd64,linux/arm64`. Decide: dev builds host-arch only (Lima parity) or both arches (CI parity).
3. **Dev-loop UX.** A long-lived VM has the property that a returning dev hits a warm cache. A fresh container per invocation may add 10-30s overhead per iteration. Mitigate via buildx cache mounts or a long-lived dev "builder" container (named, reused).
4. **CI alignment.** Currently `prebuild.yml` runs build-linux-glibc.sh directly on the runner. Moving to docker buildx on CI would mean the same `Dockerfile` runs dev + CI — but adds container overhead to a path that doesn't need it. Decide: only switch dev to Docker, leave CI as-is; OR converge both on Docker.
5. **Coexistence with `build:linux-binary`.** That task also runs in Lima today. Either:
   - Build the binary inside the same container as the prebuild (one pipeline, cleaner).
   - Keep `build:linux-binary` on Lima (mounts host source for rapid iteration) and only switch the prebuild.
6. **Removal cost of Lima builder.** `podkit-linux-builder.yaml` provisions a non-trivial toolchain. If kept around for `build:linux-binary` only, fine. If retired entirely, document the harness/test VM split (they share the yaml structure but not the toolchain).
7. **Hermeticity wins.** With ephemeral containers: no possibility of cross-realm dep tracking (the class of failure TASK-410 hit), no host node_modules paths baked into `build/Makefile`, no Bun `.bun/node-gyp@<hash>` drift between runs.

## Decision deliverable

An ADR-style write-up answering:

- Is the move worth doing now?
- What's the minimum-viable migration (e.g., just the prebuild step, leave linux-binary on Lima)?
- Static-deps caching design.
- CI/dev convergence story.

If yes, file follow-up implementation tasks. If no, close with reasoning so the question stays answered.

## Why low priority

Today's pipeline works after TASK-410. This is a *structural* improvement — pays off when the next mysterious "works on my machine vs. CI" or "works after `harness:builder:destroy`" bug hits. File now to capture context while it's fresh.

## Out of scope

- Replacing the test/harness VM (`podkit-device-harness.yaml`) — that needs kernel-level USB gadget support which Docker can't provide. Keep Lima for that.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ADR drafted comparing Lima builder VM vs. docker buildx ephemeral builder for build:linux-prebuild
- [ ] #2 Static-deps caching strategy decided (base image / cache mount / volume) with rationale
- [ ] #3 Cross-arch (amd64+arm64) strategy decided for dev path
- [ ] #4 CI alignment decided (converge with prebuild.yml or leave split)
- [ ] #5 Decision recorded on whether build:linux-binary also moves to Docker or stays on Lima
- [ ] #6 If ADR says GO: follow-up implementation tasks filed
- [ ] #7 If ADR says NO: rationale captured so the question is settled, not re-opened next time it bites
<!-- AC:END -->
