---
id: TASK-488
title: >-
  Backing-file synthesis in prepare() is load-sensitive and outside the
  bounded-wait work
status: Done
assignee: []
created_date: '2026-08-28 17:22'
updated_date: '2026-08-28 20:36'
labels:
  - testing
  - vm
  - flaky
  - performance
dependencies: []
references:
  - test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts
  - test-packages/device-testing/src/vm/dual-daemon-lifecycle.e2e.test.ts
  - test-packages/lima/src/progress.ts
priority: medium
ordinal: 267000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Observed 2026-08-28.** A `bun run test:vm` failed with `@podkit/device-testing#test:vm` at 44 pass / 1 fail: `VM: dual-daemon lifecycle`'s `beforeAll` timed out at **69s** against a 60s limit (`VM_COLD_TIMEOUT_MS`), inside `ensureBackingFilesForPersonas` (`test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts:611`). A clean re-run was 239/0.

**Confounded, and the confound is known:** a `bun run typecheck` was running concurrently, which triggered a real `podkit:build`. The device VM is 2 CPU / 2 GiB, and TASK-483's own conclusion was that load is the differentiator. So this is consistent with residual load-sensitivity rather than a regression.

**Why it is still worth a task.** TASK-483 bounded the waits it found — enumeration probes get the caller's remaining deadline, daemon start/stop 45s, journal dump 15s, apply-state 5min — and TASK-486 bounded the lifecycle operations. Neither covers backing-file synthesis in `prepare()`. That path does real work in the guest (`truncate`, `mkfs.vfat`, `mmd`/`mcopy` per persona) under a single coarse 60s hook budget, with no per-step bound and no heartbeat. Under load it can exceed the hook budget and surface as exactly the shape both of those tasks set out to eliminate: a hook timeout that names nothing useful.

So the failure mode those tasks fixed is not fully eliminated — it has retreated to the one VM-driving path they did not touch.

**Worth considering:**
- Whether the 60s hook budget is right for a path whose cost scales with persona count and image size, or whether it should derive from the work rather than being a flat constant.
- Per-step bounds plus a heartbeat inside `ensureBackingFilesForPersonas`, so a slow synthesis reports which persona and which step rather than a bare hook timeout. `test-packages/lima/src/progress.ts` already provides the heartbeat.
- Whether synthesis results can be cached across runs — the images are deterministic (`--invariant`, fixed `SOURCE_DATE_EPOCH`), and a content-addressed skip would remove most of the cost rather than merely bounding it. This is likely the highest-value option: the fastest work is work not done.

**Repro:** run `bun run test:vm` while something else saturates the host (a full `typecheck` or `build` is enough). Not deterministic.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## A second, worse instance of the same shape — and it is not the persona loop

Observed 2026-08-28 during the transport-bounding work: `mass-storage-binding.e2e.test.ts`'s `beforeEach` ran for **20.1 minutes** and died on an unbounded `limactl shell … sha256sum` in `ensureBackingFile` (`test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts:288`), reporting only `Command failed: …` with no further detail.

The file is 256 MB and hashing it takes about a second. So this was a **wedged SSH session, not slow work** — the same diagnosis as the original incident behind the wait-bounding work, in the one module that work did not reach. It passed standalone in 25s, and the full re-run was 239/0 with the device-testing suite taking 80s rather than 1292s.

This sharpens the task. Two distinct call sites in the same file are unbounded:
- `ensureBackingFilesForPersonas` (line ~611) — the synthesis loop, which is genuinely slow work under load
- `ensureBackingFile` (line ~288) — a `sha256sum` that should take a second and has no business running for twenty minutes

The second is the clearer bug and the cheaper fix: it is exactly the "should finish in seconds" bucket that `transport.ts` and `docker-image.ts` were just classified into, and the same instrument applies. Route it through `runLimactl` with a bound derived from the file size, and the failure becomes a named timeout in seconds instead of a twenty-minute hook.

The first still needs the judgement the task describes — whether to bound per step, derive the hook budget from the work, or make synthesis content-addressed so most of it is skipped.

**Also worth noting from the same session:** `stageSourceTree` into `podkit-builder-musl` failed twice with `exit=255` (SSH transport failure, sub-second) while `build:linux-prebuild` was compiling in `podkit-builder-glibc` concurrently, then succeeded when run alone. A second data point that concurrent staging into two VMs on this host is fragile — unrelated to the bounds, since a sub-second failure is not a timeout.

## Resolved — and both framings in this task were wrong

The task assumed synthesis was slow work needing either a bound or a cache. Measured inside `podkit-device` (2 vCPU, arm64), 256 MiB image:

| operation | cost |
|---|---|
| `truncate` + `mkfs.vfat --invariant` | **12 ms** |
| one `sha256sum` | **750 ms** |

The synthesis is not slow. What consumed the 60s budget was **verification**: the FAT32 paths hashed both the existing and the rebuilt image purely to populate `wasAlreadyIdentical`, a field whose own comment admitted the code "does not act on" — and which the batch caller discarded. Nine personas, hashed twice each, is ~9s of a 12s batch. Only the HFS+ branch used a hash for a real decision (skipping a `limactl copy`); that one was kept.

### Why caching would have been wrong, not merely unnecessary

This task called content-addressed caching "likely the highest-value option". It would have been a correctness bug. `gadget.ts:129` writes the canonical `vmPath` straight into `mass_storage.0/lun.0/file`, so the gadget serves the image **in place** and tests mutate it. The unconditional rebuild is not waste — **it is the reset**. A recipe-keyed skip would have served the next run the previous run's writes. Confirmed in the baseline run, where two personas reported `rebuilt` rather than `unchanged` precisely because the prior suite had written to them.

It would also have been slower: safely detecting that mutation means hashing current content (750 ms) in order to skip a 12 ms build — 60x the work it avoids.

Deriving the hook budget from the work was rejected too: it treats the symptom, since the work was 12 ms.

### What landed

Hashing is opt-in (`computeSha256`, default off), used by the determinism e2e test and the out-of-band build driver. In its place the build always emits `stat -c %s` — free, proves the script survived `set -e` past the atomic `mv`, and is **checked against the recipe**, so a wrong-sized image now fails loudly where nothing checked at all before. `sha256`/`wasAlreadyIdentical` became nullable; `sizeBytes` is always present.

All **10** `limactl` call sites in the module are now bounded via `runLimactl`. `imageWorkTimeoutMs` = 45s SSH headroom (matching the sibling daemon-lifecycle bound) plus image size at a **4 MiB/s floor**, ~85x below the measured 340 MiB/s — the same floor-not-measurement reasoning as the transport bounds. 256 MiB → 109s against 0.75s of real work. `limactl copy` reuses the substrate's `FILE_COPY_TIMEOUT_MS` rather than inventing a second derivation.

No heartbeat: the loop is now ~2s, `prepare()` has no progress sink, and threading a reporter through the runtime interface to narrate two seconds is a worse trade than silence. Each call already fails naming the persona and the argv.

**Batch: 12.0s → 2.0s.** `device-testing#test:vm` 42s, down from ~80s.

### The reset was proven, since the design now depends on it

- Mutated `echo-mini.img` in the VM (`dd` at 1 MiB) → hash changed; re-ran the batch → hash returned exactly to `bd2a378b…`. The rebuild restores recipe bytes.
- Changed a recipe input (label `ECHO_MINI` → `ECHO_ALT`) → different bytes at the same path; reverted → original hash. Determinism and input-sensitivity both hold.

### Verification

device-testing 340 tests / 0 fail; lint 0/0; typecheck 38/38; `test:vm` **239/0** on two consecutive runs plus a third by the lead, confirming correctness back-to-back over the changed path.

### Left for a follow-up

`stageBackingFile`/`resetBackingFile` (`lima-test-vm.ts:225-290`) carry the identical defect — an unbounded `sha256sum` probe and an unbounded `limactl copy`. They serve the legacy pre-built `imagePath` case that **no current persona uses**; only scripted unit tests reach them. The same instrument applies, but the fix would be unexercised by the VM suite, so it was judged a separate task rather than an untested drive-by.
<!-- SECTION:NOTES:END -->
