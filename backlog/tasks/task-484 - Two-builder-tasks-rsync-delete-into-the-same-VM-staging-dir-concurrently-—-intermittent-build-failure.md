---
id: TASK-484
title: >-
  Two builder tasks rsync --delete into the same VM staging dir concurrently —
  intermittent build failure
status: To Do
assignee: []
created_date: '2026-08-23 23:25'
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
