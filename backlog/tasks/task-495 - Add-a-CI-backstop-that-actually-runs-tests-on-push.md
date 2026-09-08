---
id: TASK-495
title: Add a CI backstop that actually runs tests on push
status: In Progress
assignee: []
created_date: '2026-09-07 23:36'
updated_date: '2026-09-08 18:21'
labels:
  - testing
  - ci
dependencies: []
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - docs/architecture/testing/taxonomy.md
priority: medium
type: task
ordinal: 274000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per ADR-028 §6.

**No CI workflow currently runs a single test.** `pr-checks.yml` builds the docs site and nothing else; `build-platform`, `prebuild`, `docker`, `release` and `verify-release` only build and publish. The entire quality gate is `bun run quality` on one developer's machine — so a machine that cannot run the suite means the suite does not run.

Add an `ubuntu-latest` job covering:

- Unit
- Integration
- E2E `host-binary` · `local-dir` · `dir`
- E2E `host-binary` · `docker-sidecar` · `dir` (runners have Docker natively; the Navidrome image is digest-pinned so it is cache-friendly)

This is a backstop, not the primary gate — rapid local loops remain the point, and CI exists to catch what an unavailable machine would otherwise silently skip. It pairs with task-492: once cells skip rather than fail, CI is what guarantees the skipped ones ran somewhere.

**Deliberately deferred:** `usb-synth` on CI. GitHub runners are full VMs and *can* `modprobe dummy_hcd`, so the gadget cells are technically reachable — but that is real work that competes directly with the substrate effort, and deciding it now would be premature. Revisit once ADR-028's slices have landed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A CI job runs unit and integration tests on pull requests
- [ ] #2 A CI job runs the host-binary · local-dir · dir E2E surface
- [ ] #3 A CI job runs the docker-sidecar surface
- [ ] #4 Turbo caching is configured so the job is not rebuilding everything from scratch each run
- [ ] #5 The docs-only path filter on pr-checks.yml does not cause the test job to be skipped on code-only PRs
- [ ] #6 pr-checks.yml is deleted and the docs-site build is still covered on PRs, via turbo rather than a path filter
- [ ] #7 //#lint hashes shell scripts and excludes node_modules/dist/build, closing the cached-green shellcheck hole
- [ ] #8 TEST_CONCURRENCY and TEST_TIMEOUT are in globalPassThroughEnv, and a final tuning pass sets concurrency to the highest value that is stable
- [ ] #9 node is pinned in mise.toml so `mise install` alone provisions a working build
- [ ] #10 A pre-flight step fails the job when docker, gpod-tool, ffmpeg, ffprobe or metaflac is missing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Decisions (grilled 2026-09-08)

**Shape.** New `.github/workflows/ci.yml`; `pr-checks.yml` deleted. Triggers `pull_request` + `push: main` + `workflow_dispatch`. Per-ref concurrency, `cancel-in-progress` only for PRs (a main run is the sole turbo-cache writer; cancelling it drops the save). Ends in an `if: always()` summary job `ci-passed`, mirroring `verify-release.yml`'s `release-ci-passed`, so branch protection has a stable name to bind before the check is made required.

**Entry point: the individual turbo tasks, not `bun run quality`.** `quality` returns `EXIT_INCOMPLETE = 2` whenever a cell was skipped, and `usb-synth` is always skipped on a runner (ADR-028 §6), so it would fail every run. Swallowing exit 2 was rejected — it would also swallow a genuinely-missing `docker-sidecar` cell, the exact failure ADR-028 §5 exists to prevent. Proper fix is task-497.

**Topology: one job.** The long pole on a code PR is `@podkit/e2e-tests#test:e2e`, a single turbo task — no job split shortens one task. ~3 min of per-job environment (apt, mise, `bun install`, cache restore, hash pass) is not in turbo's cache and would be re-paid by every job. Rejected: `setup`-job fan-out (~5 min saved for 3× runner minutes); a static/heavy 2-way split (`typecheck` `dependsOn ^build` → node-gyp → apt libgpod, so only `//#lint` is cheap-start, and husky already runs oxlint pre-commit).

**Toolchain.** `jdx/mise-action` + `mise install`, not hand-rolled `setup-bun` + apt ffmpeg — the FFmpeg pin exists because `@podkit/test-fixtures` asserts a specific encoder set, and a backstop on a different FFmpeg than the dev host cannot reproduce what the dev host sees. Use `install_args` to skip mise's dev-only tools (rust, lima, python, pipx, npm:backlog.md). `node` gets pinned in `mise.toml` — currently absent but required by node-gyp and `has-prebuild.cjs`, so a box provisioned purely from `mise install` fails at the native build.

**libgpod from apt, not built static.** Verified `libgpod-dev 0.8.3-19.1ubuntu4` is in Ubuntu 24.04 `noble/universe` (enabled by default on runners). Full list: `build-essential pkg-config libgpod-dev libglib2.0-dev libplist-dev libgdk-pixbuf-2.0-dev`. No existing workflow does this — they all build libgpod from source — but that is for *distribution* (no dynamic deps in the shipped binary), which this job does not need.

**`gpod-tool`** via `mise run tools:build`, then `echo "$PWD/bin" >> $GITHUB_PATH` explicitly rather than relying on mise-action propagating `[env] _.path`. Required by `test:unit` too, not just e2e (`@podkit/ipod-db#test:unit` → `generate-fixtures` → `generate-templates` shells `gpod-tool init`). Not cached: ~1s to build, and a cached binary can outlive an apt libgpod bump and fail at `dlopen` instead of at compile.

**Pre-flight is load-bearing, not defensive polish.** `src/docker/availability.ts:89` is `describe.skipIf(...)`, so a missing container runtime yields a green run with 8 skipped files. On a runner, absent infrastructure is a broken runner image, not an unavailable dev box — so it throws. This is what makes AC #3 verifiable rather than assumed.

**Caching.** `actions/cache` only; no remote cache. Three: turbo (`.turbo/cache`, turbo 2.9.18 default), bun's install cache (`~/.bun/install/cache`, content-keyed on `bun.lock`), and mise's own (action-managed). Rejected: caching `bin/gpod-tool`, apt packages, `node_modules`, node-gyp headers.

Turbo key uses `github.run_id` as a *deliberate* miss with `restore-keys` doing the work — a `github.sha` key never hits on the run that writes it either, it just looks like it should. Restore/save split with `if: always()` (`save-always` was removed from `actions/cache`). **Save on `main` only**: GitHub scopes caches by ref, so a PR's writes are invisible to every other PR and to main, and would cost ~500 MB per push against a 10 GB repo-wide quota shared with `build-platform.yml` and `prebuild.yml`. `linux` in the key is load-bearing — turbo's hash is platform-blind, so a macOS runner on the same prefix would restore Mach-O `.node` files. A trim step caps the cache at ~150 entries; without it each save is a superset of what it restored (~100 MB per main push, forever).

**No path filtering.** Verified against the real graph: `globalCacheInputs.files` is empty and no task's inputs touch `docs/` or `backlog/`, so those PRs replay entirely from cache in ~4–6 min. `packages/docs-site/**` is filtered by turbo's own 74 declared inputs — `@podkit/docs-site#build` is already in the graph via a phantom `test:unit`/`test:integration` dependency. That is what lets `pr-checks.yml` be deleted rather than worked around (AC #5). `build` is listed explicitly in the CI task list so nobody has to reverse-engineer why astro runs.

**No composite action.** After this work there is one full caller; `build-platform.yml`/`prebuild.yml` run in `ubuntu:20.04`/Alpine containers with bespoke apt sets and would never call it. Deferred to task-496 along with the `verify-release.yml` docs job.

**`PODKIT_CLI_BINARY` is set**, so CI exercises the compiled binary — ADR-025 defines `host-binary` as the compiled binary, and `quality` sets the same variable locally. Without it, `cli-runner.ts`'s `production` path runs `dist/main.js` under bun, a different surface than the job claims to cover.

**Concurrency.** Start `TEST_CONCURRENCY=2` on a 4-vCPU public runner (turbo would otherwise fan out 3 `gpod-tests-parallel` integration packages × 4 subprocesses = 12 test processes), with a tuning pass at the end to raise it as far as stays stable. The four tiers run as separate steps so the two e2e suites never overlap. `test:e2e:docker`'s `--concurrency 3` is a hardcoded CLI flag applied after the env default and cannot be lowered this way; left alone since Navidrome is IO-idle.

## Known-red before we start

`test-packages/e2e-tests/src/features/upgrades.test.ts:1483` fails on Linux — `expect(lossyBitrate).toBeLessThan(145)` got `228` — reproducible, and unrelated to the `turbo.json` change made alongside this task. Under diagnosis. **We cannot use "green locally" as the baseline for judging CI's first run until this is resolved.**

## Steps

1. `mise.toml`: pin `node`.
2. `turbo.json`: add `TEST_CONCURRENCY`/`TEST_TIMEOUT` to `globalPassThroughEnv`; fix `//#lint` inputs (add `**/*.sh`, negate `node_modules`/`dist`/`build`/`bin`/`.turbo`/`graphify-out`). Both invalidate the cache once.
3. Write `.github/workflows/ci.yml`; delete `pr-checks.yml`.
4. Push, observe, iterate on real runs — several unknowns can only be settled by running: whether `install_args` breaks mise's PATH export given `rust = "latest"` is pinned but unwanted, `astro build` wall time on 4 vCPU, whether `envMode: strict` strips something astro/sharp needs, and whether `TEST_CONCURRENCY=2` is over-cautious.
5. Tuning pass on concurrency.
6. Leave advisory for a few runs, then make `ci-passed` a required check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Known-red resolved (2026-09-08).** The `upgrades.test.ts:1483` failure was a test artefact, not a product bug: bun was rendering `expect(lossyBitrate).toBeLessThan(losslessBitrate)` with `losslessBitrate = 145`. The fixture is a 2s 440Hz pure sine, which ALAC squeezes to ~144 kbps while native `aac -q:a 5` is content-insensitive at ~227 — so `lossy < lossless` was a property of fixture compressibility, not of the boundary re-encode. macOS passes only because `aac_at` is content-adaptive. Replaced with the contract it was standing in for: codec name (`alac` then `aac`, invariant across encoders) plus `<= 256` (ADR-023 §2's hard ceiling). `bun run test:e2e` is now 37 passed / 0 failed, so CI's first run has a clean local baseline to be judged against.

The investigation surfaced a genuine product bug on the same path — native `aac` VBR discards `targetKbps`, so the quality cap is silently exceeded on every host without `aac_at`/`libfdk_aac`, including `ubuntu-latest`. Filed as task-499 (High), with the fragile encoder-calibrated e2e assertions catalogued in task-500. **task-499 does not block this task** — the e2e suite is green as it stands — but CI will be running against the buggy path from day one.

**Verified locally (2026-09-08).** The four CI commands resolve to 155 turbo tasks with no `test:vm`, no `docker-loopback`, no `docker-dist`, and no `@podkit/test-fixtures#generate-fixtures` (the manual-inspection collection); only `podkit#compile`, not `compile:debug`. `//#lint` inputs went from 22,752 hashed files to 1,176 — zero from `node_modules` or `dist`, and 29 shell scripts now included, matching what `lint:shell` actually checks. `ci.yml` parses; every embedded `run` block shellchecks clean apart from a deliberate SC2012 on `ls -t` (mtime order is the point; filenames are turbo hashes), which is annotated inline. `bun run lint` 0 errors / 0 warnings; `format:check` clean apart from the six pre-existing offenders task-492 recorded.
<!-- SECTION:NOTES:END -->
