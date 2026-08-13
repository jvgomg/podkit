---
id: TASK-478
title: >-
  verify-release docs job fails: astro build can't resolve workspace deps
  (@podkit/devices-ipod)
status: Done
assignee: []
created_date: '2026-08-13 20:16'
updated_date: '2026-08-13 20:47'
labels:
  - ci
  - docs
  - bug
  - release
milestone: m-22
dependencies: []
references:
  - .github/workflows/verify-release.yml
  - .github/workflows/deploy-docs.yml
  - packages/docs-site/package.json
priority: high
ordinal: 242000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Symptom:** the `Verify Docs Build` job in `verify-release.yml` fails (→ `Release CI Status` fails → the whole "Version Packages" PR run is red). Reproduced on run 31738935214 and the earlier 31089171794 — so this is PRE-EXISTING, not caused by the doc-058/quality:rc epic. Blocks every "Version Packages" PR from going green, i.e. blocks releases.

**Failure (CI log):**
```
[ERROR] [vite] ✗ Build failed
[commonjs--resolver] Failed to resolve entry for package "@podkit/devices-ipod".
The package may have incorrect main/module/exports specified in its package.json.
error: script "build" exited with code 1
```

**Root cause:** the docs job runs `bun install --frozen-lockfile --ignore-scripts` then `cd packages/docs-site && bun run build` (astro build) WITHOUT building the workspace packages docs-site imports. docs-site depends on `@podkit/compatibility` and `@podkit/devices-ipod` (both `workspace:*`, dist-based). With `--ignore-scripts` and no `turbo run build`, those packages' `dist/` never exist, so vite/rollup can't resolve their entry. It passes locally only because a dev's `dist/`s already exist from prior builds. `deploy-docs.yml` has the IDENTICAL install-then-astro-build shape → same latent bug (it deploys from the `docs-live` branch on a different cadence, so it may not have surfaced/been noticed).

**Complication (why it's not a one-liner):** naively building docs-site's dep graph pulls in native packages — `@podkit/compatibility` → `@podkit/libgpod-node` (N-API addon needing libgpod-dev/glib), and `@podkit/devices-ipod` → `@podkit/ipod-firmware`. The minimal docs runner (setup-bun only) can't compile the native addon. So the fix needs a deliberate approach, e.g.:
- build only the TypeScript dep subset docs-site actually needs (does it import runtime values from `@podkit/compatibility`/libgpod-node, or only types from devices-ipod?), OR
- provide libgpod-node via its prebuild path (select-gpod-prebuild) so a `turbo run build --filter=@podkit/docs-site^...` works without system libgpod, OR
- decouple docs-site from the native package (import types only / a browser-safe entry).

Investigate what docs-site actually imports at build time from each workspace dep, then pick the lightest fix that builds the docs site in a bare runner. Apply to BOTH `verify-release.yml` and `deploy-docs.yml` (same bug).

**Why high:** blocks the Version PR / release verification from ever going green. Also the ONLY remaining blocker to TASK-476.04 AC#6 (`quality:rc` green fetch-and-run): the RC assets are all built (binaries uploaded, multi-arch `ghcr.io/jvgomg/podkit:rc` pushed and confirmed live), but `quality:rc` correctly refuses because the run's OVERALL conclusion is red on this docs job. Once this is green, a single `bun run quality:rc` closes 476.04 AC#6.

**Related design question (note, decide separately):** should RC-readiness (resolve-rc-build) key on the whole verify-release conclusion, or only the asset-producing jobs (build + docker)? doc-058 says "the run succeeded". The docs job produces no RC asset, yet its failure currently blocks quality:rc. Out of scope for this bug; capture as a possible refinement to TASK-476.02's classifier if docs-Co-failure recurs.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Diagnosed + fixed (systematic-debugging).

Repro (tight, deterministic, ~2s): `rm -rf packages/{devices-ipod,device-types,ipod-firmware}/dist` then `cd packages/docs-site && bun run build` → reproduces the exact CI error `[commonjs--resolver] Failed to resolve entry for package "@podkit/devices-ipod"`.

Findings:
- Package entries: @podkit/devices-ipod, device-types, ipod-firmware, libgpod-node are dist-based (exports ./dist/index.js). @podkit/compatibility is SOURCE-based (exports ./src/index.ts).
- docs-site imports runtime values: getSupportMatrix from @podkit/devices-ipod; GENERATION_INFO/REAL_DEVICE_REPORTS from @podkit/compatibility.
- @podkit/devices-ipod's dependency closure = device-types + ipod-firmware, and ipod-firmware → only device-types. ALL pure TypeScript — NO native @podkit/libgpod-node in the chain.
- @podkit/compatibility resolves from source and imports libgpod-node TYPE-ONLY (`import type { IpodGeneration }` in src/helpers.ts + src/types.ts) — erased at build, so it never drags the native addon. No build needed for compatibility.

So the native-libgpod complication flagged when filing this task does NOT apply to the docs build: docs-site only needs @podkit/devices-ipod's dist (pure-TS chain) built; compatibility is consumed from source.

Fix: add a `Build docs workspace deps` step before the astro build in BOTH `verify-release.yml` (Verify Docs Build job) and `deploy-docs.yml` (same latent bug): `bunx turbo run build --filter=@podkit/devices-ipod`. Builds device-types + ipod-firmware + devices-ipod (3 pure-TS tasks, no libgpod in scope) so a bare setup-bun runner can build it.

Verified locally against the repro: after `bunx turbo run build --filter=@podkit/devices-ipod`, `bun run build` in docs-site → "[build] Complete!" + "✓ All internal links are valid." actionlint + prettier clean on both workflows.

Not a general `--filter=@podkit/docs-site^...` because that WOULD pull the native @podkit/libgpod-node (via compatibility's dep edge) and fail in the bare runner; the targeted filter lists exactly the dist-based dep docs-site needs. If docs-site later imports another dist-based (non-native) workspace package, extend the filter.

Remaining: confirm green on the live verify-release re-run, then Done.

VERIFIED GREEN IN CI + Done. Committed (40998e29), pushed, re-triggered PR #48 verify-release. The fully-green run 31741549870: ALL jobs success — check-pr, Read RC version, Verify Docs Build (the fix works in a bare CI runner), the full 6-job binary matrix, docker / Build & Push Docker Image (fresh :rc), and Release CI Status. The 'Version Packages' PR now goes green; releases unblocked. `bun run quality:rc` now discovers this ready run and proceeds to fetch + mirror (closing TASK-476.04 AC#6).
<!-- SECTION:NOTES:END -->
