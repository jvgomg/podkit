---
id: TASK-484
title: >-
  Two builder tasks rsync --delete into the same VM staging dir concurrently —
  intermittent build failure
status: Done
assignee: []
created_date: '2026-08-23 23:25'
updated_date: '2026-08-24 00:54'
labels:
  - testing
  - ci
  - vm
  - bug
  - flaky
dependencies: []
references:
  - test-packages/device-testing/scripts/build-linux-binary.sh
  - test-packages/device-testing/scripts/build-gpod-tool-linux.sh
  - test-packages/lima/src/transport.ts
priority: medium
ordinal: 263000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Symptom:** an intermittent `rsync error: some files/attrs were not transferred (code 23)` during `bun run test:vm` / `harness:setup`, aborting the whole turbo run. Observed live on 2026-08-23:

```
@podkit/device-testing:build:linux-binary: rsync: [receiver] stat "/tmp/podkit-builder-src/packages/libgpod-node/prebuilds/linux-arm64/.@podkit+libgpod-node.node.45nDWU" failed: No such file or directory (2)
@podkit/device-testing:build:linux-binary: rsync: [receiver] rename "...45nDWU" -> "packages/libgpod-node/prebuilds/linux-arm64/@podkit+libgpod-node.node": No such file or directory (2)
rsync error: some files/attrs were not transferred (see previous errors) (code 23) at main.c(1347)
```

**Cause:** `@podkit/gpod-testing#build:linux-binary` and `@podkit/device-testing#build:linux-binary` both stage the repo into the **same** VM-local destination, `podkit-builder-glibc:/tmp/podkit-builder-src`, with `rsync -a --delete`. turbo schedules them concurrently — there is no ordering edge and no mutual exclusion over the staging directory. Each rsync's `--delete` and temp-file rename races the other's, so one deletes or renames out from under the other mid-transfer.

The VM advisory lock does **not** cover this: it guards VM *start*, not source staging. Both tasks legitimately hold no lock by the time they stage, and after P3 both still stage into the same path via `stageSourceTree`.

Note this is distinct from the benign exit-24 ("file has vanished") case that `stageSourceTree` deliberately tolerates — that one is a host-side file disappearing during the read. This is exit 23, two writers colliding in the destination, and tolerating it would be wrong: the staged tree really is inconsistent afterwards.

**Why it looked rare:** with a warm `/tmp/podkit-builder-src`, both rsyncs finish almost instantly and rarely overlap. It reproduces readily on a cold builder VM, where both do a full transfer and the overlap window is wide — which is how it surfaced during the @podkit/lima P2 cold re-provision.

**Two candidate fixes:**
1. **Per-task destination directories** (e.g. `/tmp/podkit-builder-src-<task>`), so the two never share a tree. Simple and eliminates the class outright; costs extra VM disk and a full first sync per task rather than a shared incremental one.
2. **A stage-scoped lock** keyed on `(vm, destination)`, reusing the existing `proper-lockfile` helper in `@podkit/lima`. Keeps the shared incremental tree and the warm-cache benefit, at the cost of serialising two builds that could otherwise overlap.

Option 1 is likely the better trade — the tasks build different artifacts and there is little real sharing to preserve — but it should be measured against cold-build wall-clock before committing.

**Related:** the same shared-destination pattern exists for the musl builder (`build-musl-prebuild.sh` / `build-musl-binary.sh`), which is currently safe only because those two are not scheduled concurrently today. Worth fixing both while in there rather than leaving a latent copy.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Resolved via option 1 (per-caller destinations), registered in the substrate

Destinations are no longer spelled in any wrapper. `test-packages/lima/src/staging.ts` holds a typed staging registry keyed `(vm, dest)`; wrappers resolve theirs via a new `podkit-vm stage-path <instance> --area <id>` verb.

## Option 2 was rejected on correctness, not cost

This is the part worth keeping. A stage-scoped lock would **not** have made the shared tree safe, because the two tasks also *mutate* it after staging: `build-linux-binary.sh` runs `bun install`, a turbo build and three `compile.sh` invocations in the tree while `build-gpod-tool-linux.sh` runs `make clean && make` in the same place.

Concretely: `packages/podkit-daemon/bin` is **not** in `DEFAULT_STAGE_EXCLUDES`, so a gpod-tool stage landing mid-build would `--delete` the VM-built `podkit-daemon` before `limactl copy` retrieved it. That is silent corruption, not a loud exit 23 — the reported bug was the visible half of a wider one. Making a lock genuinely safe would mean holding it across stage -> build -> copy-out, serialising a multi-minute build to avoid a 5.5s overlap.

## Measurements

| | |
|---|---|
| Cold full stage into an empty builder dest | 5.5 s for 1.2 GB — a wide, easily-hit window |
| Naive second full tree would cost | +1.2 GB |
| What gpod-tool's tree actually costs | **172 KB, 0.15 s** |
| Net builder-VM disk after the change | **3.8 GB free, up from 3.4 GB** |

The stated cost of option 1 did not materialise: gpod-tool compiles one `.c` against apt's `libgpod-1.0`/`glib-2.0` via pkg-config, so `--src` was narrowed to `tools/gpod-tool` rather than staging the repo. Its only outside reference is the optional private-header path under `tools/libgpod-macos/build`, which the exclude floor already prunes — which is why `HAVE_LIBGPOD_PRIVATE` is already off on Linux.

## Drive-by worth its own mention

`graphify-out` (320 MB, gitignored, read by no VM) was being rsynced into **every** staged tree. Excluding it cut a cold full stage from 5.5 s / 1.2 GB to 3.1 s / 838 MB and freed 400 MB in the builder — so this change nets *negative* disk despite adding a directory, and it narrows the window the whole bug class lives in.

## Two corrections to this task's own premise

- **The musl pair never actually shared a destination** (`/tmp/podkit-musl-libgpod-build` vs `/tmp/podkit-musl-builder-src`). The premise was wrong, but the underlying point stands: nothing *enforced* the separation. Both are now registered and covered by the disjointness test.
- **`packages/podkit-docker/test/image-smoke.sh` was load-bearing** and not in the task's file list: it hard-coded `/tmp/podkit-builder-src` and compiles the daemon in the tree `build:linux-binary` leaves behind. Renaming that path without finding it would have broken the Docker smoke test silently.

## Verification

**Reproduced first:** emptied the shared dest, ran both stage invocations concurrently -> `exit=1`, `code 23`, same signature as the original report. **After:** both real wrapper scripts run concurrently -> both exit 0, plus 3x repeated cold concurrent stages all `rc=0` with empty stderr.

Artifacts: gpod-tool `fccb9fbe…` byte-identical before/after (independently confirmed by `harness:install` reporting a sha256 skip); glibc prebuild `74ffb770…` byte-identical. lint 0/0, typecheck 38/38, build 21/21, `harness:install` exit 0, 126 lima tests, 303 device-testing tests.

`turbo.json` needed no change — all five build tasks already declare `$TURBO_ROOT$/test-packages/lima/src/**` as an input, so `staging.ts` invalidates them correctly. Verified by parsing the config rather than assuming.

## Left open, deliberately

`BUILD_CONTEXT_VM_DIR = /tmp/podkit-image-ctx` in `docker-image.ts` is not registered, because its VM is a runtime parameter rather than a static pairing. It is `rm -rf`'d and rebuilt by `buildPodkitImageInVm`, whose only two callers bun runs sequentially in one process — so it is single-writer **by scheduling, not by construction**. That is exactly the shape the musl pair had before this change. Worth revisiting if anything ever builds images in parallel.

Separately: the stored musl prebuild artefact was stale relative to a from-scratch rebuild of current main (`efe6ff5e…` -> `ba661b8c…`). Isolated and shown NOT to be caused by this change — reverting to HEAD produced the same new hash, and two further rebuilds were stable. `prebuilds/` is gitignored, so this is local drift rather than a defect.
<!-- SECTION:NOTES:END -->
