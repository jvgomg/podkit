---
id: TASK-463
title: >-
  vm-docker-image e2e Stage 2: pull a pre-release GHA-built Docker image for the
  local harness gate
status: In Progress
assignee: []
created_date: '2026-07-11 15:27'
updated_date: '2026-08-06 09:52'
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
  - test-packages/e2e-tests/src/docker/podkit-image.ts
  - test-packages/device-testing/src/runners/lima-docker-image.ts
  - .github/workflows/build-platform.yml
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

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A GHA workflow builds + pushes a moving pre-release image tag `ghcr.io/jvgomg/podkit:edge` on push to main (path-gated to podkit binary/Docker sources), reusing docker.yml's build; never touches :latest/:version/:minor
- [x] #2 docker.yml accepts a pre-release tag mode: when set it pushes ONLY the edge tag and skips the release tags; the existing release-invoked path is unchanged
- [x] #3 A scheduled workflow prunes untagged GHCR manifests weekly (delete-only-untagged) to bound bloat from :edge overwrites
- [x] #4 A shared image-source switch (env `PODKIT_DOCKER_DIST_IMAGE`) selects local-build vs pull:<tag> for BOTH the host loopback-fat (tier 4) and the VM usb-synth (tier 5) surfaces
- [x] #5 Tier-5 pull path: `sudo nerdctl pull` the edge tag into the harness VM (anonymous — image is public, no auth) and run the existing persona flow against it
- [x] #6 Tier-4 pull path: `docker pull` the edge tag onto host Docker and run the loopback-fat CLI flow against it
- [x] #7 Documented dev command: push branch -> wait for the edge image -> run the docker-dist (and loopback) e2e against the pulled image; recorded in agents/docker.md + doc-053
- [x] #8 Edge image is arm64-only (matches both local consumers); amd64 explicitly deferred unless an amd64 gate lands
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Resolved design (supersedes the task body's open questions)

Open questions from the description are RESOLVED (user decisions 2026-08-05):
- **Trigger/tag** = moving `:edge` on push to main (NOT workflow_dispatch/PR-label per-sha). `workflow_dispatch` kept as a manual escape hatch.
- **Retention** = single overwritten tag + weekly `delete-only-untagged` prune.
- **Auth** = NONE. `ghcr.io/jvgomg/podkit` is public; anonymous pull verified (registry token + manifest 200) on both host Docker and in-VM nerdctl. The description's ghcr-auth question is moot.
- **Arch** = arm64-only edge (both consumers are arm64: host Docker Desktop on Apple Silicon = tier 4; arm64 Lima VM = tier 5).
- **Scope insight** = the image-source switch is NOT tier-5-only. Tiers 4 and 5 have mirror "build image from local musl binaries" runners; both get the pull path.

### M1 — GHA edge seam
- New `.github/workflows/docker-edge.yml`: `on: push:[main]` (path-gated to `packages/podkit-{cli,core,daemon,docker,libgpod-node}/**`, Dockerfile, entrypoint) + `workflow_dispatch`. `concurrency: docker-edge, cancel-in-progress:true`.
- Build musl arm64 binaries (lean job or a `musl-only`/arch input on build-platform.yml — avoid spinning the full macOS+glibc matrix), then call docker.yml.
- Extend `docker.yml` with a pre-release input (e.g. `prerelease-tag`): when set, generate ONLY `ghcr.io/jvgomg/podkit:<tag>` and push; skip the :latest/:version/:minor block. Release path untouched.

### M2 — GHCR prune
- New scheduled `.github/workflows/docker-prune.yml` (weekly): `actions/delete-package-versions` with `delete-only-untagged: true` on package `podkit`.

### M3 — Shared image-source switch (tier 4 + tier 5)
- One env `PODKIT_DOCKER_DIST_IMAGE`: unset -> local-build (current default); set to a tag -> pull.
- Tier 5: add `pullPodkitImageInVm()` beside `buildPodkitImageInVm` in `runners/lima-docker-image.ts` (`sudo nerdctl pull`, ensure containerd up, return the tag).
- Tier 4: add `pullPodkitImageOnHost()` beside `buildPodkitImageOnHost` in `e2e-tests/src/docker/podkit-image.ts` (`docker pull`).
- Shared resolver helper deciding build-vs-pull from the env, so `image.docker-dist.test.ts`, `daemon.docker-dist.test.ts`, and the tier-4 loopback tests all route through it instead of the hardcoded build call.

### M4 — Dev command + docs
- Document: push -> wait for edge image (gh run watch) -> `PODKIT_DOCKER_DIST_IMAGE=ghcr.io/jvgomg/podkit:edge bun run test:e2e:docker-dist` (and the tier-4 loopback script). Update `agents/docker.md` + doc-053.

### Verify (empirical, done this session)
- `curl https://ghcr.io/token?scope=repository:jvgomg/podkit:pull` -> anon token; `/tags/list` + `/manifests/latest` -> 200. Package is public; no PAT / nerdctl login needed anywhere.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Landed (2026-08-05)

**GHA seam (M1).** `docker.yml` gained two inputs — `platforms` (default `linux/amd64,linux/arm64`) and `prerelease-tag` (default `''`). When `prerelease-tag` is set, the tags step emits ONLY `ghcr.io/jvgomg/podkit:<tag>` and skips :latest/:version/:minor; amd64 artifact downloads + the libc-gate loop are now arch-conditional (`contains(inputs.platforms,'amd64')` + a `bin/*/podkit` glob). Defaults reproduce the exact prior release behaviour, so release.yml's + verify-release.yml's calls (which pass only version/push) are unaffected. New `docker-edge.yml`: push-to-main (path-gated to podkit-{cli,core,daemon,docker,libgpod-node} + the workflow files) + workflow_dispatch, `concurrency: docker-edge cancel-in-progress`; calls `build-platform.yml` (musl-only, arches=arm64) then `docker.yml` (version=0.0.0-edge, platforms=linux/arm64, prerelease-tag=edge, push). `build-platform.yml` gained `musl-only` + `arches` inputs gating the macOS/glibc/musl-x64 jobs (defaults unchanged).

**Prune (M2).** New `docker-prune.yml`: weekly cron + dispatch, `actions/delete-package-versions@v5` `delete-only-untagged-versions: true` on package `podkit`.

**Image-source switch (M3).** One env `PODKIT_DOCKER_DIST_IMAGE` (exported const `DOCKER_DIST_IMAGE_ENV` in both runners). Tier-5 `lima-docker-image.ts`: `pullPodkitImageInVm` (start containerd only, `sudo nerdctl pull`, anonymous) + `ensurePodkitImageInVm` (env set→pull, unset→build); extracted `startUnit`. Tier-4 `podkit-image.ts`: `pullPodkitImageOnHost` (`docker pull`, `HostDockerRunner` DI seam) + `ensurePodkitImageOnHost`. Wired image/daemon docker-dist VM tests + the loopback test to `ensure*` via a mutable IMAGE tag.

**Docs (M4).** `agents/docker.md` new "Gating against the real GHA-built image (`:edge`)"; doc-053 stage-5 "Local run" gained the Stage-1-vs-Stage-2 paragraph.

## Verification done
- Anon access is real: registry token + `/tags/list` + `/manifests/latest` 200; AND a live `docker pull --platform linux/arm64 ghcr.io/jvgomg/podkit:latest` succeeded with NO login (proves tier-4 pull mechanic + public/no-auth end-to-end).
- Unit tests: VM-side `lima-docker-image.test.ts` 7/7 + host-side `docker/podkit-image.test.ts` 5/5. Full device-testing runner suite 136/136.
- `actionlint` clean on all 4 workflows (fixed an SC2044 find-loop). `typecheck` clean across device-testing + e2e-vm-tests + e2e-tests. `oxlint` 0/0 on all changed files.

## Sonnet review (2026-08-05) — clean on correctness; 3 findings, all resolved
Review confirmed: release/verify-release paths byte-for-byte unchanged via defaults; prerelease tag logic can ONLY push `:edge` (no external input surface); libc-gate glob, `contains()` gates, mutable-IMAGE wiring (beforeAll runs before any `it`), env-trim edge cases, and no-stale-call-sites all verified.
- **[Medium] host pull path had no unit coverage** → FIXED: added `HostDockerRunner` DI seam + `test-packages/e2e-tests/src/docker/podkit-image.test.ts` (5 tests) + a real `test:unit` lane on `@podkit/e2e-tests` (wired into turbo `test:unit`; `docker/` excluded from the e2e sweeps so it doesn't hit the iPod harness).
- **[Low] `ensurePodkitImageOnHost` ignored-options doc gap** → FIXED: JSDoc now states `tag`/`arch` are pull-path no-ops.
- **[Low/info] shared release+edge cache scope** → ACCEPTED with a clarifying comment in docker.yml (intentional warm-cache; content-addressed, so no correctness coupling).

## Remaining (cannot run headless — needs a push + the harness VM)
- **AC#1 / AC#5 live proof.** The real `:edge` e2e loop: push branch to main → docker-edge.yml builds `:edge` → `PODKIT_DOCKER_DIST_IMAGE=ghcr.io/jvgomg/podkit:edge bun run test:e2e:docker-dist` (and docker-loopback). The `:edge` tag doesn't exist until the workflow first runs; the pull-path CODE + host pull mechanic are proven, but the full VM persona run against a real `:edge` is the post-merge manual gate (AC#1/#5 left unchecked until then).
- `docker-prune.yml` / `docker-edge.yml` triggers can only be confirmed to fire once on `main` (GITHUB_TOKEN package-delete permission on the user-owned `podkit` package validated on first scheduled/dispatch run).

LIVE PROOF LANDED (2026-08-06): pushed to origin/main → docker-edge.yml run 31089105372 succeeded (only Build linux-arm64 ran; x64-musl/glibc/macOS jobs skipped via the musl-only+arches gates; amd64 downloads skipped in docker.yml). Verified `ghcr.io/jvgomg/podkit:edge` is a linux/arm64-only index and `:latest`+0.2.x release tags are untouched. Then ran the tier-5 e2e against the PULLED image: `ghcr.io/jvgomg/podkit:edge` present in the VM (freshly pulled) + all 6 docker-dist tests green (device add→sync→read-back, --version routing, both daemon lanes, SIGTERM drain, Apprise). AC#1 + AC#5 now proven live; all 8 ACs checked. CAVEAT: the turbo env-passthrough for PODKIT_DOCKER_DIST_IMAGE was MISSING (strict-mode filter) — the first turbo run silently used the stale local `podkit:docker-dist` build, not `:edge`. Fixed in turbo.json globalPassThroughEnv (tracked under TASK-475) and re-verified. docker-prune.yml + the first scheduled prune still only observable once it fires.
<!-- SECTION:NOTES:END -->
