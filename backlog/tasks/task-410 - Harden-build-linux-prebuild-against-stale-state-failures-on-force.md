---
id: TASK-410
title: 'Harden build:linux-prebuild against stale-state failures on --force'
status: To Do
assignee: []
created_date: '2026-06-08 07:08'
labels:
  - build
  - tech-debt
  - follow-up
  - libgpod-node
dependencies: []
references:
  - tools/prebuild/build-linux-glibc.sh
  - tools/prebuild/build-linux-prebuild.sh
  - packages/libgpod-node/binding.gyp
  - packages/libgpod-node/package.json
priority: low
ordinal: 125000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

During TASK-400 implementation (commit `627f2c7f`), `bunx turbo run build:linux-prebuild --force` failed with a `collect2: error: ld returned 1 exit status` / `gyp ERR! build error` against the builder VM. Workaround at the time: don't `--force` unless the prebuild really changed.

Follow-up investigation (opus, 2026-06-08) found:

- **Today's build succeeds** when run on a primed VM with cached static deps. Original failure was a stale-state issue that has since cleared.
- Builder VM environment: Node v22.22.2 (LTS), Bun 1.3.14, node-addon-api 8.6.0, prebuildify 6.0.1, node-gyp 11.5.0.
- **Fragility 1 (root cause):** `bunx prebuildify --napi --strip` in `tools/prebuild/build-linux-glibc.sh` does not clean `build/` between runs. A `--force` run with stale intermediates triggers the linker failure.
- **Fragility 2 (latent):** `prebuildify --napi` selects the latest Node target headers (currently Node 25) for compilation, while runtime is Node 22. `napi_build_version` in `build/config.gypi` is filled from the running Node (22 → ABI 10). The header/ABI split has not yet caused observable breakage but is a future-fragility surface as `node-abi` updates.

## Fix candidates (in priority order)

### A. Add a clean step to prebuildify (low effort, high confidence)

In `tools/prebuild/build-linux-glibc.sh`, change:
```sh
bunx prebuildify --napi --strip
```
to:
```sh
bunx prebuildify --napi --strip --preinstall "node-gyp clean"
```

The `--preinstall` flag runs `node-gyp clean` before each build (which `rm -rf build`). Idempotent: clean of an already-clean tree is a no-op. Eliminates any stale-state regression for `--force` runs.

### B. Pin the target Node version (medium effort)

In the same script, change to:
```sh
bunx prebuildify --napi --strip --target node@22 --preinstall "node-gyp clean"
```

Forces prebuildify to use Node 22 headers (matching runtime). Removes the Node 22 vs Node 25 header split. Verify the binary still loads on Node 20 + Node 22 + Node 24 LTS runtimes after the change — prebuildify still produces an N-API binary; the target only affects which headers compile against.

### C. Documentation

Add a one-paragraph note to `packages/libgpod-node/CONTRIBUTING.md` (or equivalent — create if missing) explaining the `--force` semantics and the `--preinstall` choice for future contributors.

## Verification

Each fix requires a real builder-VM run to confirm:

```bash
bunx turbo run @podkit/device-testing#build:linux-prebuild --force 2>&1 | tail -30
```

Run cold (delete `packages/libgpod-node/build/` first) AND with stale state (modify a `binding.gyp` line then revert), confirm both succeed. ~10-15 min per run.

## Acceptance

- Fix A applied; cold + stale-state `--force` runs both succeed.
- Fix B applied (or explicitly deferred with reason); ABI compatibility verified on Node 20/22/24 LTS.
- One-paragraph note explaining `--force` semantics added to the relevant doc.
- No existing prebuild tests break.

## Why low priority

Today's build path works on primed VMs. The fix is purely defensive — eliminates a future regression surface that has bitten exactly once observably. No user impact; affects only the prebuild release pipeline + dev workflow when iterating on `binding.gyp`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 bunx prebuildify invocation in build-linux-glibc.sh gains --preinstall 'node-gyp clean' (Fix A)
- [ ] #2 Cold-cache + stale-state --force runs both succeed in the builder VM
- [ ] #3 Decision recorded on whether to also apply Fix B (--target node@22) with justification
- [ ] #4 If Fix B applied: ABI compatibility verified on Node 20/22/24 LTS runtimes
- [ ] #5 One-paragraph note in packages/libgpod-node/CONTRIBUTING.md (or equivalent) explains --force semantics + clean-build invariant
- [ ] #6 No regressions in existing prebuild outputs or downstream consumers
<!-- AC:END -->
