---
id: TASK-476.03
title: 'Produce :rc, retire :edge (workflow)'
status: In Progress
assignee: []
created_date: '2026-08-06 18:22'
updated_date: '2026-08-06 22:22'
labels:
  - docker
  - ci
  - release
  - ready-for-agent
milestone: m-22
dependencies: []
references:
  - >-
    backlog/docs/doc-058 -
    RFC-quality-rc-—-verify-the-release-candidate-locally-against-the-exact-CI-built-assets.md
  - .github/workflows/verify-release.yml
  - .github/workflows/docker.yml
  - .github/workflows/docker-edge.yml
  - .github/workflows/docker-prune.yml
parent_task_id: TASK-476
ordinal: 239000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**What to build:** the "Version Packages" PR's release-verification workflow **pushes** the release-candidate Docker image as a single moving pre-release tag `:rc`, and the per-push `:edge` mechanism is retired.

Change the verification workflow's docker job from build-only to build-and-push `:rc` (reusing the existing pre-release-tag machinery in the reusable Docker build workflow — push only that tag, never the `:latest`/`:version`/`:minor` release tags). Keep it **multi-arch** (so the workflow still verifies the amd64 image builds and still warms the release cache) and stamp the real release-candidate version. Gate the push to **same-repo (non-fork)** PRs. Delete the per-push edge workflow and stop producing `:edge`. Keep the reusable-workflow inputs `:rc` reuses (pre-release-tag / platforms; musl-only / arches) and keep the untagged-manifest prune (retarget its doc/comments to `:rc`).

**Blocked by:** None — can start immediately.

**Domain notes:** the release path (release workflow, release tags, tarballs, Homebrew) must be byte-for-byte unaffected — this is push-only behaviour on a tag namespace disjoint from the release tags. Full green verification requires a live "Version Packages" PR; static verification is `actionlint` + confirming the release/verify-release call sites.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a "Version Packages" PR, the release-verification workflow builds AND pushes a single moving multi-arch `ghcr.io/jvgomg/podkit:rc`, never the :latest/:version/:minor release tags
- [x] #2 The `:rc` push is gated to same-repo (non-fork) PRs
- [x] #3 The per-push docker-edge workflow is deleted and `:edge` is no longer produced; the reusable-workflow inputs it shared with `:rc` (pre-release-tag/platforms, musl-only/arches) remain
- [x] #4 The untagged-manifest prune still runs and covers `:rc`
- [ ] #5 actionlint passes on all workflows; the release path and its cache-warming are unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Workflow changes landed (not committed).

verify-release.yml:
- New `rc-version` job (checkout + `jq -r .version packages/podkit-cli/package.json`) exposes the real release-candidate version as an output. In pre-release-tag mode this feeds only the VERSION build-arg / image label, never a pushed tag.
- `docker:` job flipped from build-only (`version: 0.0.0-verify`, `push: false`) to build-AND-push `:rc`: `version: ${{ needs.rc-version.outputs.version }}`, `push: true`, `prerelease-tag: rc`. No `platforms` set → stays multi-arch (linux/amd64,linux/arm64), preserving amd64 build verification + release cache warming so `:rc` mirrors the release manifest.
- Fork gate on the pushing job's `if:`:
  `needs.check-pr.outputs.is_version_pr == 'true' && needs.build.result == 'success' && github.event.pull_request.head.repo.full_name == github.repository`
- Granted `permissions: { contents: read, packages: write }` on the docker job (mirrors how docker-edge.yml granted it) so the reusable workflow's GITHUB_TOKEN can push. Other jobs (check-pr, build, rc-version, docs) need no elevated permissions; no top-level block added.
- `release-ci-passed` still references `needs.docker.result` unchanged.

docker-edge.yml: deleted (`git rm`). `:edge` is no longer produced.

docker-prune.yml: comment block retargeted from the `:edge` edge build to the `:rc` release-candidate build. `delete-only-untagged-versions: true` is generic and already sweeps untagged `:rc` manifests — no logic change.

docker.yml: inputs `prerelease-tag` and `platforms` retained. Stale `:edge` references in comments (input example, single-arch download note, tag-generation note, shared-cache-scope note) repointed to `:rc`. No logic change.

build-platform.yml: `musl-only` and `arches` inputs retained (now unused by any caller, kept as reusable seams per AC#3). Comments that named "the Docker edge build" updated to neutral wording.

Quality gates:
- actionlint (/opt/homebrew/bin/actionlint, homebrew binary) run over all workflows. My edits introduce ZERO new findings. Two findings remain and are PRE-EXISTING on HEAD in code I did not touch: verify-release.yml:16 (`github.event.pull_request.title` untrusted, in the untouched check-pr step) and release.yml:172 (SC2129 style). Verified pre-existing by running actionlint against `git show HEAD:` copies.
- `bunx prettier --check` on all four edited YAML files: pass ("All matched files use Prettier code style"). .prettierignore does not exclude .github YAML.
- git status: only verify-release.yml, docker.yml, docker-prune.yml, build-platform.yml modified; docker-edge.yml deleted. release.yml untouched.

Deferred to a live run (not checkable statically):
- AC#1 full-green: requires an open "Version Packages" PR whose verification build actually pushes multi-arch `ghcr.io/jvgomg/podkit:rc`. Static parts verified: prerelease-tag path pushes only `:rc`, multi-arch default preserved, real version stamped.
- AC#5: the actionlint-passes clause is satisfied for my changes but two pre-existing findings remain repo-wide (documented above); release path / cache-warming unchanged is verified statically (release.yml untouched, shared cache scope `docker-main` preserved, multi-arch kept).

Known out-of-scope caveat (unchanged): docker.yml BUILD_DATE uses `github.event.head_commit.timestamp`, empty on pull_request events — documented as out-of-scope "build-date label differs", not fixed here.

Team-lead review (Sonnet) verdict: SHIP-WITH-NITS. Core properties all PASS: release-tag isolation (push:true only flows through docker.yml prerelease-tag→:rc branch; :latest/:version/:minor unreachable), non-fork gate on the pushing job, multi-arch default preserved (cache warming intact), version stamped from cli package.json via rc-version job output, packages:write scoped to docker job, prune covers :rc, retained reusable inputs (prerelease-tag/platforms, musl-only/arches).

Fix applied by team lead: added a workflow-level `concurrency` guard (group: verify-release-<pr#>, cancel-in-progress: true) to verify-release.yml — now that the docker job PUSHES the moving :rc tag, concurrent synchronize events would race the tag last-writer-wins and hand rc-discovery a nondeterministic image (the deleted docker-edge.yml had the equivalent guard). actionlint re-run: only the pre-existing untrusted-title warning remains; prettier clean.

Deferred to TASK-476.04 (its AC#5 doc scope): agents/docker.md still documents the retired :edge mechanism (PODKIT_DOCKER_DIST_IMAGE=...:edge, references to docker-edge.yml / gh run watch --workflow=docker-edge.yml) — must be repointed to :rc when 04 updates docs.

Code complete + committed (commit 584617e7). Remaining: AC#1/#5's live-run portion — verify a real 'Version Packages' PR run pushes multi-arch `ghcr.io/jvgomg/podkit:rc` and never a release tag. Requires these commits pushed to the remote so the Version PR's next verify-release run uses the updated workflow. Maintainer push/CI step.
<!-- SECTION:NOTES:END -->
