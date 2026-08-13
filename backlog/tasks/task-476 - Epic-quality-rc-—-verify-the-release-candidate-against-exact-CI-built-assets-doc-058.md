---
id: TASK-476
title: >-
  Epic: quality:rc — verify the release candidate against exact CI-built assets
  (doc-058)
status: Done
assignee: []
created_date: '2026-08-06 18:21'
updated_date: '2026-08-13 21:20'
labels:
  - testing
  - ci
  - docker
  - vm
  - release
  - epic
milestone: m-22
dependencies: []
references:
  - >-
    backlog/docs/doc-058 -
    RFC-quality-rc-—-verify-the-release-candidate-locally-against-the-exact-CI-built-assets.md
ordinal: 236000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Master/epic for the doc-058 RFC. Deliver two mirror quality commands — `quality` (local assets) and `quality:rc` (the exact CI-built release-candidate assets) — so a maintainer can verify what's about to ship (mac + linux binaries + Docker image) locally, before merging the "Version Packages" PR.

Design, user stories, decisions: **doc-058**. Sub-tickets are `ready-for-agent`; implement in the children, not here.

Sub-tickets (dependency order):
1. `quality` becomes the full local mirror (prefactor) — no blockers.
2. RC-build discovery + preflight decision (seam + unit tests) — no blockers.
3. Produce `:rc`, retire `:edge` (workflow) — no blockers.
4. `quality:rc` — fetch CI assets + run the mirror (integration) — blocked by 1, 2, 3.

Builds on TASK-475 (delivered the override seams, `cliSpawnArgv`, turbo passthrough, two-phase body; completes its deferred CI-byte-fidelity AC) and repoints TASK-463's `:edge` machinery to `:rc`.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
doc-058 delivered end-to-end. Two mirror quality gates now run the identical shipped-surface set (standard DAG + docker-dist + docker-loopback, two-phase VM-serialized, host e2e on a real compiled binary), differing only in asset source:

- `bun run quality` — local builds. Verified GREEN end-to-end (94/94 + 25/25).
- `bun run quality:rc` — the exact CI-built release-candidate assets. Verified GREEN end-to-end against live 'Version Packages' PR #48: fetched the arm64 Mach-O host binary + glibc arm64 VM binary, pulled multi-arch ghcr.io/jvgomg/podkit:rc (confirmed via manifest inspect), test:vm 194/0 on the fetched binary, docker surfaces 6/0 + 3/0. Completes TASK-475's deferred CI-byte-fidelity AC.

Subtasks: 476.01 (quality→local mirror) ✓ · 476.02 (rc-build discovery/preflight seam, 15 unit tests, validated live) ✓ · 476.03 (verify-release pushes multi-arch :rc, non-fork gate, concurrency guard; :edge + docker-edge.yml retired) ✓ · 476.04 (quality:rc fetch+mirror) ✓.

Discovered + fixed en route (separate tasks): TASK-477 (two save-failure-matrix VM-timeout bugs — aggregate beforeAll budget derived from cell count; runDoctor made resilient to transport timeouts under turbo concurrency) and TASK-478 (verify-release/deploy-docs docs build now builds docs-site's pure-TS workspace deps before astro, unblocking every Version PR / release).

All code committed + pushed to main. Docs updated (agents/testing.md, agents/docker.md, doc-053) with the honest fidelity caveat (:rc = same recipe + shared cache as release, functionally the release bytes but not bit-identical) and release-candidate-window scoping.
<!-- SECTION:FINAL_SUMMARY:END -->
