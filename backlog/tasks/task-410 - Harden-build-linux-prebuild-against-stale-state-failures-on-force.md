---
id: TASK-410
title: 'Harden build:linux-prebuild against stale-state failures on --force'
status: Done
assignee: []
created_date: '2026-06-08 07:08'
updated_date: '2026-06-08 07:47'
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
  - test-packages/device-testing/scripts/build-linux-prebuild.sh
  - test-packages/device-testing/scripts/build-linux-binary.sh
  - turbo.json
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
- [x] #1 build-linux-prebuild.sh refactored to VM-local rsync pattern (mirrors build-linux-binary.sh)
- [x] #2 tools/prebuild/build-linux-glibc.sh prebuildify call gains --target node@22.x
- [x] #3 turbo.json inputs for @podkit/device-testing#build:linux-prebuild gain packages/libgpod-node/package.json + bun.lock
- [x] #4 Cold-cache --force run succeeds in builder VM
- [x] #5 Stale-state --force run succeeds in builder VM (modify+revert binding.gyp test)
- [x] #6 Run after bun.lock change succeeds (cache-invalidating real-world scenario)
- [x] #7 ABI compatibility verified on Node 20/22/24 LTS via tools/lima/podkit-abi-verify.yaml
- [x] #8 Block comment in build-linux-glibc.sh explains VM-local invariant + --target pin
- [x] #9 TASK-411 filed for docker buildx investigation
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach (revised after investigation)

Root cause is **not** "prebuildify doesn't clean between runs" — it's host/VM filesystem aliasing.

Evidence from `packages/libgpod-node/build/`:
- `Makefile` references `/Users/james/.../node_modules/.bun/node-gyp@<hash>` (host)
- `.o` files compiled with `-I/tmp/prebuildify/node/25.0.0/...` (VM-local) and `-I/home/james.guest/.cache/podkit-static-deps/...` (VM-local)
- source tree itself sits on host-mounted FS

`build/` is half-host, half-VM. node-gyp's dep tracking (`build/Release/.deps/**/*.d`) bakes absolute paths only valid in one realm. `--force` reruns through changing Bun `.bun/node-gyp@<hash>` dirs produce incoherent dep graphs → linker failure.

Sibling script `build-linux-binary.sh` already solved this — rsyncs to `/tmp/podkit-builder-src` and runs `bun install` in-VM. `build-linux-prebuild.sh` did not. Restoring symmetry is the structural fix.

## Steps

1. Refactor `test-packages/device-testing/scripts/build-linux-prebuild.sh` to mirror `build-linux-binary.sh`:
   - rsync repo → `/tmp/podkit-libgpod-build` (VM-local), excluding `node_modules`, `.turbo`, `dist`, `.git`, `build/`, `prebuilds/`.
   - `bun install --frozen-lockfile --ignore-scripts` inside VM.
   - Run `tools/prebuild/build-linux-glibc.sh` from VM-local tree.
   - Copy final `*.node` from VM-local prebuilds back to host-mounted tree (only the artifact crosses realms; intermediates stay VM-local).
2. In `tools/prebuild/build-linux-glibc.sh`: add `--target node@22.x` to `bunx prebuildify` invocation. Pin headers to LTS 22 instead of letting `node-abi` silently drift to Node 25. Add comment block documenting the VM-local invariant + the pin reason.
3. Add `packages/libgpod-node/package.json` + `bun.lock` to `turbo.json` inputs for `@podkit/device-testing#build:linux-prebuild` so prebuildify/node-gyp version changes invalidate cache.
4. Verify cold + stale-state `--force` + post-`bun-reinstall` runs all succeed.
5. ABI verify on Node 20/22/24 LTS via existing `tools/lima/podkit-abi-verify.yaml`.

## Dropped from original ticket

- Fix A (`--preinstall "node-gyp clean"`): superseded. With VM-local build tree, `build/` is recreated under `/tmp` each run — already cleanest possible state.
- Fix C (CONTRIBUTING.md): a 3-line block comment in `build-linux-glibc.sh` covers the same ground colocated. Avoids future-rot risk of a separate doc.

## Out of scope (filed separately)

- Replacing the Lima builder VM with `docker buildx` ephemeral containers — captured in TASK-411 for later decision.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation (2026-06-08, opus)

Code changes complete; user will verify with real builder-VM runs.

### Files modified

- `tools/prebuild/build-linux-glibc.sh` — added `--target node@22.11.0` to `bunx prebuildify` call; added comment block documenting the VM-local source tree invariant + `--target` pin rationale.
- `test-packages/device-testing/scripts/build-linux-prebuild.sh` — rewritten to mirror `build-linux-binary.sh`: rsync repo to `/tmp/podkit-libgpod-build`, `bun install --frozen-lockfile --ignore-scripts` in-VM, run `build-linux-glibc.sh` from VM-local tree, copy final `*.node` to host-mounted prebuilds dir at the end of the in-VM script.
- `turbo.json` — added `packages/libgpod-node/package.json` + `bun.lock` to `@podkit/device-testing#build:linux-prebuild` inputs.

### Design decisions

- Final-artifact cross-realm copy is done via `cp` inside the VM (writing to the host-mounted prebuilds dir) rather than via `limactl copy` from the host. Single round trip, no surprises with `limactl copy` recursive semantics.
- Static-deps cache (`$HOME/.cache/podkit-static-deps`) and work dir (`$HOME/.cache/podkit-prebuild-work`) stay in user home, NOT in `/tmp/podkit-libgpod-build`. Survives rsync `--delete` and is reused across rebuilds — preserves the 10-15 min static-deps build amortization.
- Pinned to Node 22.11.0 specifically (Node 22 LTS launch release). Headers don't drift across Node 22.x patch releases — N-API surface is stable.

### Verification status (deferred to user)

The 3 verification scenarios in the acceptance criteria require real builder-VM runs (~10-15 min each). Code is ready for the user to drive verification before marking Done.

### Linked

- TASK-411 (docker buildx investigation) filed for the larger structural refactor.

## Verification (2026-06-08, opus)

All four scenarios PASS. Logs at `/tmp/podkit-scenario{1,2a,2b}.log`.

### Scenario 1 — cold-cache `--force`

Wiped `packages/libgpod-node/{prebuilds,build}/`, `.turbo/`, and `/tmp/podkit-libgpod-build/`. Ran `bunx turbo run @podkit/device-testing#build:linux-prebuild --force`.

Result: SUCCESS in 13.19s (static-deps cache warm from prior runs).

Key log lines confirm structural goals:
- `module_root_dir=/tmp/podkit-libgpod-build/packages/libgpod-node` — build tree is VM-local, not host-mounted.
- `node_gyp_dir=/tmp/podkit-libgpod-build/node_modules/.bun/node-gyp@11.5.0/...` — node_modules resolved in-VM, paths internally coherent.
- `node_root_dir=/tmp/prebuildify/node/22.11.0` — Node 22.11.0 headers pinned as intended (previously 25.0.0).
- ldd verification passed (only `libm`, `libstdc++`, `libgcc_s`, `libc`, `ld-linux`).
- Final artifact copied from VM-local to host: `packages/libgpod-node/prebuilds/linux-arm64/@podkit+libgpod-node.node` (10.4 MB).

### Scenario 2 — stale-state `--force` (binding.gyp churn)

The pattern that bit during TASK-400: edit binding.gyp, build, revert binding.gyp, build with `--force`.

Safe mutation: added an unused `"PODKIT_TASK_410_MUTATION=1"` define to the `defines` array (doesn't affect compile).

Results:
- 2a (mutated): SUCCESS in 11.535s
- 2b (reverted): SUCCESS in 11.123s

Under the old script this exact pattern produced `collect2: error: ld returned 1 exit status`. The VM-local rsync pattern eliminates the failure class — `/tmp/podkit-libgpod-build/build/` is regenerated coherently each run instead of being a hybrid host/VM artifact.

### Scenario 3 — `bun.lock` change invalidates cache

Baseline hash (clean tree): `983cb09ddc5faa9f`, cache HIT.

Appended a single newline to `bun.lock`. New hash: `081e6a8b5910015e`, cache MISS.

Confirms the turbo.json input wiring (`$TURBO_ROOT$/bun.lock`) correctly invalidates the prebuild task when the lockfile changes. Without this, a `bun add node-gyp@<newer>` would have produced a false cache hit and the stale prebuild would have been served.

### Scenario 4 — ABI compat across Node 20 / 22 / 24 LTS

Used the builder VM (already has Node 22.22.2 as system) and installed nvm + Node 20.20.2 (lts/iron) + Node 24.16.0 (lts/krypton).

For each Node version, attempted to load the prebuild via `require()` and read the top-level keys.

Results:
```
=== Node 20 ===
v20.20.2
LOAD OK [ 'Database', 'PhotoDatabase', 'Device', 'parse', 'parseFile' ]
=== Node 22 ===
v22.22.2
LOAD OK [ 'Database', 'PhotoDatabase', 'Device', 'parse', 'parseFile' ]
=== Node 24 ===
v24.16.0
LOAD OK [ 'Database', 'PhotoDatabase', 'Device', 'parse', 'parseFile' ]
```

N-API ABI compatibility confirmed across all three current LTS lines. Pinning `--target node@22.11.0` for compilation does not constrain runtime loadability — exactly the guarantee N-API provides.

### Side observation worth noting

The prebuild filename is `@podkit+libgpod-node.node` (no `.napi.` tag in the filename). `src/binding.ts:findPrebuild` searches for `.includes('napi')` first, then falls back to `nodeFiles[0]`. The fallback path is what wins today. This is fine but a touch surprising — if anyone ever drops a non-napi `.node` file in the same directory the loader behavior gets ordering-dependent. Out of scope for TASK-410; flagging in case it becomes interesting.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
**Build pipeline hardened: VM-local source tree, Node target pinned, lockfile in cache key.**

Root cause: `bunx turbo run @podkit/device-testing#build:linux-prebuild --force` could fail with `collect2: error: ld returned 1 exit status` because the libgpod-node build tree lived on Lima's host-mounted FS. node-gyp baked host paths (`/Users/.../node_modules/.bun/node-gyp@<hash>/...`) into `build/Release/.deps/*.d` while object files compiled with VM-local includes (`/tmp/prebuildify/node/<ver>/...`, `/home/james.guest/.cache/podkit-static-deps/...`). When Bun's content-addressed `.bun/node-gyp@<hash>` dir reshuffled between runs, dep tracking went incoherent and linking broke.

### Fix

- `test-packages/device-testing/scripts/build-linux-prebuild.sh` — rewritten to mirror its sibling `build-linux-binary.sh`: rsync repo to `/tmp/podkit-libgpod-build`, `bun install --frozen-lockfile --ignore-scripts` in-VM, run `tools/prebuild/build-linux-glibc.sh` from the VM-local tree, copy only the final `*.node` artifact back to the host-mounted prebuilds dir. Single-quoted heredocs with positional-arg host-var injection so every `$VAR` inside expands in the VM realm with no quoting ambiguity.
- `tools/prebuild/build-linux-glibc.sh` — added `--target node@22.11.0` to the `bunx prebuildify` invocation (previously selected the latest Node line known to `node-abi`, currently Node 25 — silent input drift turbo couldn't see). Added comment block documenting both the VM-local invariant and the `--target` pin rationale.
- `turbo.json` — added `packages/libgpod-node/package.json` + `bun.lock` to the `@podkit/device-testing#build:linux-prebuild` inputs so prebuildify/node-gyp version changes invalidate the cache (they didn't before).

### Verification

All four scenarios PASS:

1. Cold-cache `--force` → SUCCESS (build tree under `/tmp/podkit-libgpod-build/`, Node 22.11.0 headers, static linking verified).
2. Stale-state `--force` (binding.gyp mutate+revert) → SUCCESS both runs. Original failure pattern neutralised.
3. `bun.lock` touch → turbo hash `983cb09d` → `081e6a8b`, cache MISS as expected.
4. ABI compat on Node 20.20.2 / 22.22.2 / 24.16.0 (LTS iron/jod/krypton) → LOAD OK on all three with identical top-level keys. N-API ABI guarantee confirmed.

### Dropped from original ticket

- **Fix A** (`--preinstall "node-gyp clean"`): superseded. With the VM-local build tree, `build/` is recreated under `/tmp` on every run — already cleanest possible state.
- **Fix C** (CONTRIBUTING.md note): a block comment in `build-linux-glibc.sh` covers the same ground colocated. Avoids future-rot risk of a separate doc.

### Out of scope (filed separately)

- **TASK-411** — investigate replacing the Lima builder VM with ephemeral `docker buildx` containers. Same `Dockerfile` for dev + CI, no long-lived stateful VM, hermetic by construction.

### Side note worth flagging

The prebuild filename is `@podkit+libgpod-node.node` — no `.napi.` tag in the filename. `src/binding.ts:findPrebuild` searches for `.includes('napi')` first then falls back to `nodeFiles[0]`. The fallback path is what wins today. Works while there's a single `.node` in the dir; latent ordering-dependent bug if anyone ever drops a second one. Out of scope here.
<!-- SECTION:FINAL_SUMMARY:END -->
