---
id: TASK-476.04
title: 'quality:rc — fetch CI assets + run the mirror (integration)'
status: In Progress
assignee: []
created_date: '2026-08-06 18:22'
updated_date: '2026-08-06 22:22'
labels:
  - testing
  - ci
  - docker
  - vm
  - release
  - ready-for-agent
milestone: m-22
dependencies:
  - TASK-476.01
  - TASK-476.02
  - TASK-476.03
references:
  - >-
    backlog/docs/doc-058 -
    RFC-quality-rc-—-verify-the-release-candidate-locally-against-the-exact-CI-built-assets.md
  - package.json
  - agents/testing.md
  - agents/docker.md
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
parent_task_id: TASK-476
ordinal: 240000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**What to build:** `bun run quality:rc` — the CI mirror. It discovers the release-candidate build (ticket 2), and either fails fast with an actionable message (no "Version Packages" PR / build in progress / build failed; `--wait` opt-in to block on in-progress), or fetches the release-candidate assets and runs ticket 1's mirror body against them.

On the ready path it fetches exactly two artefacts for arm64 — the compiled **mac** binary (host e2e) and the **glibc** linux binary (the Debian harness VM) — into a git-ignored scratch dir, points the existing override envs at them, sets the image override to pull `:rc` (the musl binaries + daemon live inside the image), and execs the same two-phase body as `quality`. Then wire docs and close out.

**Blocked by:** ticket 1 (mirror body), ticket 2 (preflight decision), ticket 3 (`:rc` must exist for a green end-to-end run).

**Domain notes:** arm64-only (both consumers are arm64); no standalone daemon artefact needed. Fidelity caveat to document honestly: `:rc` assets are the same recipe + shared cache as release, functionally the release bytes but not bit-identical. Completes TASK-475's deferred CI-byte-fidelity AC.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `bun run quality:rc` preflights via ticket 2 and, when not ready, exits non-zero with the state-specific actionable message (no version PR / in-progress+url / failed+url); `--wait` blocks on in-progress until green
- [x] #2 On the ready path it fetches the arm64 mac binary and the arm64 glibc linux binary into a git-ignored scratch dir, points PODKIT_CLI_BINARY + PODKIT_LINUX_BINARY at them, and sets PODKIT_DOCKER_DIST_IMAGE to pull `:rc`
- [x] #3 It then runs the identical two-phase mirror body from ticket 1 — only the asset source differs from `bun run quality`
- [x] #4 No standalone daemon artefact is fetched (the daemon is exercised inside the `:rc` image); an explicit run-id override is supported
- [x] #5 Docs updated: agents/testing.md (quality vs quality:rc), agents/docker.md, doc-053 — including the honest fidelity caveat and the release-candidate-window scoping
- [ ] #6 End-to-end green against a live "Version Packages" PR (fetched Mach-O arm64 host binary, glibc arm64 in the VM, `:rc` pulled for the docker surfaces); TASK-475's deferred CI-fidelity AC is closed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented `bun run quality:rc` as the CI mirror of `bun run quality`, sharing one two-phase body.

Files added:
- `test-packages/device-testing/scripts/run-mirror-body.ts` — the single shared two-phase body. Exports `runMirrorBody(extraArgs)`: phase 1 `bunx turbo run qa <args>` (includes test:vm), then phase 2 `bunx turbo run test:e2e:docker-dist test:e2e:docker-loopback <args>`. Spawns turbo from the repo root (resolved via import.meta.url), inherits `process.env` (never sets any PODKIT_* itself — the caller does), forwards extra argv to BOTH phases, short-circuits on the first non-zero exit. Runnable directly (`import.meta.main`) — this is the `quality` body.
- `test-packages/device-testing/scripts/quality-rc.ts` — the CI mirror. Parses `--wait` / `--run-id <id>` / `--help`; forwards any other args to both mirror phases. Calls `resolveRcBuildState({ subprocess: defaultSubprocessRunner, wait, runId })` (ticket 2's pure fn, real `gh` via the exported defaultSubprocessRunner). Non-ready → prints `formatNonReadyMessage(state)` to stderr and returns exit 1. Ready → clears + fetches into scratch, sets env, calls `runMirrorBody(passthrough)`. Exports `formatNonReadyMessage` for the message test.
- `test-packages/device-testing/scripts/quality-rc.test.ts` — asserts the three non-ready messages name the situation + surface the url (no gh, no network).

Files changed:
- root `package.json`: `"quality": "PODKIT_CLI_BINARY=\"$PWD/packages/podkit-cli/bin/podkit\" bun test-packages/device-testing/scripts/run-mirror-body.ts"` and new `"quality:rc": "bun test-packages/device-testing/scripts/quality-rc.ts"`.
- `.gitignore`: added `test-packages/device-testing/.rc-assets/`.
- `agents/testing.md`: replaced the stale "Release-candidate quality gate" section with "The two quality mirrors (`quality` / `quality:rc`)" — identical surfaces, local vs CI assets, the shared two-phase body, local-only + Docker Desktop + Lima harness + `gh` auth, the three fail-fast states, arm64 scope, and the fidelity caveat.
- `agents/docker.md`: repointed the "Gating against the real GHA-built image" section from `:edge`/`docker-edge`/`gh run watch --workflow=docker-edge.yml` to `:rc`/`verify-release.yml`, noting the `:edge` retirement, `quality:rc` as the one-command path, and the fidelity/scope caveat.
- `backlog/docs/doc-053` (via document_update): Stage-1-vs-2 paragraph now uses `:rc` from `verify-release.yml`, notes the `:edge` retirement + `quality:rc`, plus the fidelity/window caveat.

Shared-body approach: both commands funnel through `runMirrorBody`; `quality` runs it directly (sets local PODKIT_CLI_BINARY), `quality:rc` imports and calls it after assembling the fetched-asset env — so the surface set cannot drift. Passthrough is preserved because runMirrorBody forwards argv to both turbo phases; validated by dry-run (see below).

Artefacts fetched (exactly two, arm64) — names match `actions/upload-artifact` in `.github/workflows/build-platform.yml`, each tarball's sole entry is `podkit`:
- mac: artifact `podkit-darwin-arm64` → `gh run download <runId> --name podkit-darwin-arm64 --dir <scratch>/mac`, extract → `podkit` → PODKIT_CLI_BINARY.
- glibc linux: artifact `podkit-linux-arm64-gnu` → `gh run download <runId> --name podkit-linux-arm64-gnu --dir <scratch>/linux`, extract → `podkit` → PODKIT_LINUX_BINARY.
No musl binary, no daemon artefact fetched (they live in the `:rc` image). PODKIT_DOCKER_DIST_IMAGE=ghcr.io/jvgomg/podkit:rc so both docker surfaces PULL. All other PODKIT_* left unset.
Scratch path: `test-packages/device-testing/.rc-assets/` (git-ignored; `git check-ignore` confirms).

Message copy per non-ready state (printed to stderr, exit 1):
- no-version-pr: "No release candidate to verify." — no open "Version Packages" PR; points to `bun run quality` for a local check and to opening one (bunx changeset → version PR).
- build-in-progress: "Release-candidate build still in progress." — prints the run url; "Re-run with --wait to block until it turns green, or come back once it has completed."
- build-failed: "Release-candidate build failed." — prints the run url; "Fix the release-candidate build first — there are no shippable assets to gate against until it is green."

Validation (cheap only; full VM green deferred): `bunx tsc --noEmit -p test-packages/device-testing/tsconfig.json` exit 0; oxlint clean on the added/changed files (and the whole device-testing dir); prettier applied; `bun test quality-rc.test.ts` 3/3 pass; `check-cli-stderr-writes.mjs` OK; `git check-ignore .../.rc-assets/x` confirms ignored. Passthrough: `bun run quality -- --dry=text` shows BOTH "Running qa in 24 packages" and "Running test:e2e:docker-dist, test:e2e:docker-loopback in 24 packages" — the flag reaches both phases. `bun run quality:rc --help` renders usage.

AC#6 (end-to-end green) left UNCHECKED: deferred — needs a live "Version Packages" PR with `:rc` in GHCR (post-merge) AND the pre-existing save-failure-matrix.e2e.test.ts VM-wedge fix (60s beforeAll timeout blocks any full test:vm run). Not attempted per ticket scope.

Team-lead review (Sonnet) verdict: SHIP-WITH-NITS — no must-fix.

Critical checks PASS: exit-code propagation (run-mirror-body phase1 exit short-circuits phase2 and propagates via process.exit — the gate actually fails red suites), preflight wiring (all 3 non-ready states → stderr + exit 1; RcBuildDiscoveryError caught, message-only no stack), exactly-two-artefacts (mac + glibc only; musl/daemon stay in :rc; PODKIT_DOCKER_DIST_IMAGE=:rc, other PODKIT_* untouched), scratch dir git-ignored + scoped rm, shared body (both commands funnel through runMirrorBody's single PHASE_1/PHASE_2 lists — no drift), bunx turbo resolves the pinned workspace 2.9.18.

Artifact names independently verified by team lead against build-platform.yml: mac = podkit-darwin-arm64 (matrix platform:darwin arch:arm64, line ~60/211); glibc = podkit-linux-arm64-gnu (line 817), correctly distinct from the MUSL podkit-linux-arm64 (line 600) that docker.yml bakes into the image (asserts ld-musl). Tarball inner name `podkit` matches.

Nit fixed by team lead: added a line to agents/testing.md documenting turbo's `--` semantics (args after `--` are forwarded to the task command, not turbo flags — so `--force -- --dry=text` runs a real build, not a dry-run). prettier clean.

AC#6 (end-to-end green) remains DEFERRED: needs (a) TASK-476.03 merged to main + a re-triggered verify-release run so `ghcr.io/jvgomg/podkit:rc` exists in GHCR, and (b) the TASK-477 save-failure-matrix VM wedge fixed so a full test:vm phase can go green. Design note (per doc-058 Testing Decisions): run-mirror-body's spawn/short-circuit glue is intentionally thin and left to e2e validation, not unit-tested — the unit-tested seam is 476.02's decision fn.

Local blocker cleared: TASK-477 fixed, so a full `bun run quality` (the LOCAL mirror, identical body) is now green end-to-end. The `quality:rc` code path (discovery/preflight/fetch/shared-body) is complete + committed. AC#6 (CI-asset end-to-end) is the ONLY remaining item and needs a live `:rc` in GHCR — i.e. these commits pushed + the open 'Version Packages' PR's verify-release re-run producing `ghcr.io/jvgomg/podkit:rc`. That's a maintainer push/CI step (no local substitute).
<!-- SECTION:NOTES:END -->
