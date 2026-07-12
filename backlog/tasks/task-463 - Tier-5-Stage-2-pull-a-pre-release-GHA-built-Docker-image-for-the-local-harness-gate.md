---
id: TASK-463
title: >-
  vm-docker-image e2e Stage 2: pull a pre-release GHA-built Docker image for the
  local harness gate
status: To Do
assignee: []
created_date: '2026-07-11 15:27'
updated_date: '2026-07-12 12:52'
labels:
  - docker
  - testing
  - vm
  - ci
milestone: m-22
dependencies:
  - TASK-451
references:
  - .github/workflows/docker.yml
  - .github/workflows/release.yml
  - test-packages/e2e-vm-tests/
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
  - documents/architecture/testing/taxonomy.md
  - adr/adr-025-canonical-test-taxonomy.md
priority: medium
ordinal: 223000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
> Classification: the **E2E · `vm-docker-image` · `local-dir` · `usb-synth`** surface of the [test taxonomy](../../documents/architecture/testing/taxonomy.md) (doc-053's retired "Tier 5"). Note the planned directory rename `test-packages/e2e-vm-tests/src/docker-dist/` → `vm-docker/` — the Stage-2 runner path moves with it.

## Why

TASK-451 (the `vm-docker-image` scaffold) Stage 1 builds the podkit image *locally in-VM* from the Dockerfile — fast dev loop, but not the literal artifact CI ships. The goal (per the m-22 harness thinking) is a local pre-merge / pre-release gate that runs the harness against the **actual GHA-built image**, so a release candidate is verified end-to-end before merge/release.

## Current gap

`.github/workflows/docker.yml` is `workflow_call`-only and is invoked by `release.yml` **only at release time** (Version Packages merge or manual dispatch), pushing `:<version>`/`:latest`/`:<minor>` to `ghcr.io/jvgomg/podkit`. There is NO PR/RC/branch/sha path that builds+pushes a *pullable pre-release* image. So "run the harness against a pre-release GHA image" is not a config away — a new seam must be built.

## What (design, then implement)

1. Add a GHA seam that builds + pushes a pre-release image on demand — e.g. `workflow_dispatch` (and/or a label-gated PR trigger) that tags the image `ghcr.io/jvgomg/podkit:rc-<shortsha>` (or `:pr-<n>`), reusing docker.yml's build (it already has `cache-from/to: type=gha,scope=docker-main`, so cache is warm). Do NOT touch the `:latest`/release tags.
2. Local harness wiring: extend the `vm-docker-image` runner (from TASK-451) with an image-source switch — `local-build` (Stage 1 default) vs `pull:<tag>` (Stage 2). For `pull`, `sudo nerdctl pull` the RC tag into the VM (needs ghcr auth — a read token; document the login step) and run the same persona flow against it.
3. A documented developer command: build+push an RC from the current branch via `gh workflow run`, wait for it, then run the `vm-docker-image` e2e against the pulled image — the pre-merge verification loop.

## Dependencies / scope
- Depends on TASK-451 landing the Stage-1 runner + persona flow (this task only adds the image-source=pull path + the GHA pre-release seam).
- macOS Docker Desktop can't pass USB to containers, so the harness still runs inside the Linux VM (same as Stage 1).

## Open questions for design
- Trigger shape: workflow_dispatch vs PR-label. RC tag scheme + retention (avoid ghcr bloat — TTL/cleanup).
- ghcr auth for in-VM pull (read:packages token; where stored).
- Whether to also expose an amd64 pull path or keep arm64-only for the local VM.
<!-- SECTION:DESCRIPTION:END -->
