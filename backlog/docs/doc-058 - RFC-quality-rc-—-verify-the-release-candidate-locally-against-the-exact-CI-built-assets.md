---
id: doc-058
title: >-
  RFC: quality:rc — verify the release candidate locally against the exact
  CI-built assets
type: specification
created_date: '2026-08-06 18:14'
updated_date: '2026-08-06 18:16'
tags:
  - testing
  - ci
  - docker
  - vm
  - release
  - m-22
  - rfc
  - ready-for-agent
---
> Milestone: m-22. Supersedes TASK-475 AC#6 and folds in the retirement of the `:edge`/`docker-edge` mechanism introduced by TASK-463. Companion to doc-053 (podkit-docker testing strategy) and ADR-021 (CLI Bun binary distribution).

## Problem Statement

Before a podkit release, I want to run the whole quality suite against the **exact artefacts that are about to be shipped** — the mac binary, the linux binaries, and the Docker image — not against local rebuilds that only approximate them. Today `bun run quality` verifies source plus a *bundle proxy* of the CLI (`dist/main.js` under bun), never the shipped Bun `--compile` binaries, and it excludes the shipped-image surfaces (`docker-dist`, `docker-loopback`) entirely. So the one class of bug I most want to catch before shipping — "the compiled/packaged artefact behaves differently from the dev bundle" — is exactly the class the everyday gate cannot see. I want a single, easy-to-understand command that hooks into the builds already produced for the release and runs everything locally against them, and that tells me clearly when those builds aren't ready.

## Solution

Two **mirror** commands with an identical set of test surfaces; the only difference is *which assets the surfaces run against*:

- **`quality`** — the full local gate. Runs everything (lint, typecheck, unit, integration, host e2e, host-docker source e2e, VM e2e, and the two shipped-image surfaces `docker-dist` + `docker-loopback`) against **locally built** assets: the locally compiled CLI binary, the local glibc/musl builds, and a locally built image.
- **`quality:rc`** — the same surfaces run against the **CI-built release-candidate assets**: the compiled mac binary and the glibc linux binary fetched from the release-candidate build, and the Docker image pulled as a moving pre-release tag `:rc`.

The release-candidate build already exists: the **"Version Packages" PR** (the changesets version bump) triggers the release-verification workflow, which builds the full binary matrix and the Docker image and shares the release build cache. That workflow is made to **push its image as `:rc`**, and `quality:rc` fetches that run's uploaded binaries and pulls `:rc`. When no release candidate is in flight — or its build is still running or has failed — `quality:rc` **fails fast with an actionable message** rather than silently degrading.

The previously-added continuous per-push `:edge` image (and its `docker-edge` workflow) is **retired**: with `quality` building the image locally and `quality:rc` pulling `:rc`, `:edge` no longer has a consumer, and one pre-release image concept is simpler than two.

## User Stories

1. As a maintainer about to cut a release, I want one command that runs the entire quality suite against the exact binaries and image the release will publish, so that I catch packaged-artefact-only regressions before users do.
2. As a maintainer, I want `quality` and `quality:rc` to test the identical surfaces, so that a green `quality` locally means the same checks will pass against the real assets — only the asset source changes.
3. As a maintainer, I want the everyday `quality` gate to also exercise the shipped Docker image surfaces (`docker-dist`, `docker-loopback`), so that "quality is green" actually means the image works, not just the source.
4. As a maintainer, I want `quality`'s host e2e to run the real compiled binary rather than the dev bundle proxy, so that the everyday gate reflects what ships.
5. As a maintainer running `quality:rc` when no "Version Packages" PR is open, I want a clear message telling me there is no release candidate and how to create one (or to use `quality` for a local check), so that I am never confused about why it did nothing.
6. As a maintainer running `quality:rc` while the release-candidate build is still running, I want to be told the build is in progress with a link, and to have the option to wait, so that I don't sit through a silent hang and I can choose to block or come back later.
7. As a maintainer running `quality:rc` when the release-candidate build has failed, I want to be told the build itself is red with a link, so that I fix the build before trying to gate against non-existent assets.
8. As a maintainer, I want `quality:rc` to fail fast by default and only wait when I pass an explicit flag, so that the common case is quick feedback, not a 15-minute block.
9. As a maintainer on an Apple Silicon machine, I want the gate to fetch and run the arm64 mac binary and the arm64 glibc linux binary and pull the arm64 image variant, so that it matches my host and the arm64 harness VM.
10. As a maintainer, I want the release-verification workflow to push a single moving `:rc` tag that never touches the `:latest`/`:version`/`:minor` release tags, so that gating never risks publishing a real release tag.
11. As a maintainer, I want the `:rc` image to remain multi-arch, so that the release-verification workflow keeps checking that the amd64 image builds and keeps warming the release cache, and so that `:rc` faithfully mirrors the release manifest.
12. As a maintainer, I want stale untagged `:rc` manifests swept automatically, so that repeated release-candidate builds don't bloat the container registry.
13. As a security-conscious maintainer, I want the `:rc` push to be gated to non-fork PRs, so that a fork PR titled "Version Packages" cannot push an image built from untrusted code.
14. As a maintainer, I want only two "quality" commands to remember, so that the tooling stays easy to understand.
15. As a maintainer, I want `quality:rc` to fetch its binaries into a git-ignored scratch location, so that fetched artefacts never pollute the working tree.
16. As a maintainer, I want the daemon steady-state still verified through the `:rc` image (the daemon is baked into the image), so that I don't need a separate standalone daemon artefact that CI doesn't build.
17. As a maintainer, I want `quality:rc` to reuse the same two-phase execution as `quality` (VM-bound suites serialized after the rest), so that the shared Lima harness VM is never driven by two suites at once.
18. As a maintainer, I want honest documentation of the fidelity guarantee — that `:rc` artefacts are the same build recipe and shared cache as release, hence functionally the release bytes but not bit-identical — so that I understand exactly what the gate does and does not prove.
19. As a maintainer, I want the release path (release workflow, `:latest`/tarballs/Homebrew) to be completely unaffected by this change, so that adding a pre-release gate carries no release-time risk.
20. As a contributor reading the docs, I want a clear statement that CI-fidelity gating only exists during the release-candidate window and that feature-branch iteration uses `quality`, so that I don't expect `:rc` to exist for arbitrary branches.
21. As a maintainer, I want to be able to pin an explicit build run when auto-discovery finds the wrong one, so that I retain manual control.

## Implementation Decisions

- **Two mirror commands.** `quality` (local assets) and `quality:rc` (CI assets). Both run the identical surface set: the standard quality DAG plus the two shipped-image surfaces (`docker-dist`, `docker-loopback`), with the host e2e pointed at a real compiled binary rather than the bundle proxy. The commands differ only in the values of the existing override environment variables. Both remain **local-only** (never run in GitHub CI) and require Docker Desktop plus the Lima harness VM.

- **Reuse existing override seams — no new consumption mechanism.** The image-source switch (`PODKIT_DOCKER_DIST_IMAGE`, unset = build locally, set = pull the tag, honoured by both the tier-4 host and tier-5 VM runners), the host-binary override (`PODKIT_CLI_BINARY`, points the host e2e at a standalone compiled binary, invoked directly via the shared `cliSpawnArgv` decision), and the VM binary overrides (`PODKIT_LINUX_BINARY` etc.) already exist and are already forwarded through turbo's strict env filter. `quality` sets these to local build outputs; `quality:rc` sets them to fetched artefact paths and `:rc`.

- **Two-phase execution stays.** Both commands run the standard DAG first, then the shipped-image surfaces, because `test:vm` and `docker-dist` share the one harness VM and collide if run concurrently.

- **Release-candidate image = `:rc` from the release-verification workflow.** The verification workflow's Docker job changes from build-only to build-and-push a single moving pre-release tag `:rc`, reusing the pre-release-tag machinery already present in the reusable Docker build workflow (push only that tag; never the release tags). It stays **multi-arch** (preserving amd64 build verification and cache warming) and stamps the real release-candidate version. The push is gated to same-repo (non-fork) PRs. The untagged-manifest prune already covers `:rc`.

- **Retire `:edge`.** Delete the per-push edge image workflow and stop producing the `:edge` tag. Keep the reusable-workflow input additions that `:rc` reuses (pre-release-tag / platforms on the Docker build; musl-only / arches on the platform build) and keep the prune workflow.

- **New RC-asset fetch tool.** A small script performs discovery → preflight → fetch, then execs the shared two-phase body with the CI-asset env values. Discovery: locate the most recent release-verification run for the open "Version Packages" PR (with an explicit run-id override available). Preflight classifies the release-candidate build into a typed state and, by default, fails fast on any non-ready state; a `--wait` flag blocks on the in-progress state until green.

  The preflight decision (encodes the core behaviour precisely):

  ```
  type RcBuildState =
    | { kind: 'no-version-pr' }                          // nothing to gate; guide to `quality` / changeset
    | { kind: 'build-in-progress'; runId; url }          // fail fast, or wait with --wait
    | { kind: 'build-failed'; runId; url }               // fix the build first
    | { kind: 'ready'; runId; prNumber }                 // proceed to fetch + run
  ```

- **Artefacts fetched: exactly two.** The compiled **mac** binary (host e2e) and the **glibc** linux binary (harness VM is Debian/glibc). The musl binaries and the daemon are **not** fetched standalone — they are inside the `:rc` image, which the docker surfaces pull. Fetched artefacts land in a git-ignored scratch directory.

- **Arch scope: arm64.** Both local consumers (Apple-Silicon host, arm64 harness VM) are arm64; the gate fetches arm64 artefacts and pulls the arm64 variant of the multi-arch `:rc`.

- **Release path untouched.** The release workflow, its tags, tarballs, and Homebrew step are unchanged. The verification-workflow change is push-only behaviour on a tag namespace disjoint from the release tags.

- **Command taxonomy.** The former local-rebuild `quality:rc` is absorbed: `quality` becomes the local mirror; `quality:rc` becomes the CI mirror. `bun run test` remains the fast unit+integration tier. No third "quality" command.

## Testing Decisions

- **What a good test is here.** Assert external behaviour, not implementation. For the one piece of real new logic — release-candidate discovery + preflight classification — feed scripted command-runner outputs (representing `gh` responses) and assert the returned `RcBuildState` and the chosen run, plus the guard behaviours (no version PR, in-progress, failed, ready; and `--wait` vs fail-fast). Do not assert on how the commands were shelled out beyond the decision they encode.

- **Single seam, highest point.** Extract the discovery/preflight into a pure function that takes an **injected command runner** (the existing `SubprocessRunner`-style DI seam) and returns the typed decision. Unit-test that function. The side-effecting glue (artefact download, extraction, env assembly, invoking the two-phase body) is intentionally thin and left to end-to-end validation, not unit tests.

- **Modules tested.** The RC-asset discovery/preflight decision function (new). No new tests for the workflow YAML (validated by lint + a live release-candidate run) or for the package scripts (validated by running them).

- **Prior art to follow.** The scripted-`SubprocessRunner` runner tests (the Lima docker-image and systemd runner tests), the `HostDockerRunner` DI test for the host image runner, and the `getCliPath`/`cliSpawnArgv` override tests — all inject a fake command runner and assert argv/decisions with no real subprocess. Follow that structure.

- **End-to-end acceptance (manual, needs a live release candidate).** With a "Version Packages" PR open and its verification build green: `quality:rc` fetches the Mach-O arm64 binary (host e2e runs it directly), transfers the glibc arm64 binary to the harness VM (`test:vm`), and pulls `:rc` for the docker surfaces; the full run is green. Also verify each fail-fast state produces its message.

## Out of Scope

- **True bit-for-bit reproducibility.** `:rc` artefacts are the same recipe and shared cache as release, hence functionally the release bytes, but not a cryptographic guarantee of identical bytes (e.g. the image build-date label differs). Documented, not eliminated.
- **amd64 / non-arm64 local gating.** The gate is arm64-only to match both consumers; a cross-arch local gate waits until an amd64 local surface exists.
- **On-demand CI-fidelity gating for arbitrary feature branches.** CI-fidelity is scoped to the release-candidate window; feature-branch iteration uses `quality` (local) or the existing manual platform-build dispatch as an escape hatch.
- **A standalone glibc daemon artefact.** Not needed — the daemon is verified inside the `:rc` image.
- **A lighter/faster `quality:rc` subset.** Possible future convenience; not part of this spec.

## Further Notes

- Correcting a common mental model: the full asset build does **not** run on every push. Regular PRs build only docs; the only always-on build is (was) the per-push `:edge` image. The full "assets about to ship" build happens at exactly two moments — the "Version Packages" PR (verification workflow: builds + uploads binaries, builds image) and the release itself. This RFC hooks the local gate into the first of those two moments, which is precisely the "ready together before merge" state.
- The verification workflow already shares the release prebuild cache, so pushing `:rc` from it warms — rather than duplicates — the release build.
- Relationship to existing work: TASK-463 delivered the `:rc`-reused machinery (pre-release-tag push mode, platform-build inputs, prune) under the `:edge` name; this RFC keeps that machinery and repoints it from `:edge` to `:rc`. TASK-475 delivered the override seams, `cliSpawnArgv`, turbo passthrough, and the two-phase body; this RFC completes its open AC (drive the actual CI-built assets).
