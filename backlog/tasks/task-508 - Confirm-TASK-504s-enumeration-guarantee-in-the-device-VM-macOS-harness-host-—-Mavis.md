---
id: TASK-508
title: >-
  Confirm TASK-504's enumeration guarantee in the device VM (macOS harness host
  — Mavis)
status: Done
assignee: []
created_date: '2026-09-12 13:47'
updated_date: '2026-09-13 15:32'
labels:
  - testing
  - vm
  - concurrency
  - flakiness
  - human-in-the-loop
dependencies:
  - TASK-504
references:
  - test-packages/device-testing/src/runners/lima-test-vm.ts
  - test-packages/device-testing/src/runners/lima-enumeration.ts
  - test-packages/e2e-vm-tests/src/pre-sync-sweep.e2e.test.ts
  - test-packages/e2e-vm-tests/src/doctor-device-types.e2e.test.ts
  - test-packages/e2e-vm-tests/src/doctor-output-contract.e2e.test.ts
  - test-packages/e2e-vm-tests/src/discovery-reconciliation.e2e.test.ts
  - docs/architecture/testing/vm-testing.md
priority: high
type: task
ordinal: 287000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Run this on a machine that can host the device harness.** TASK-504's code has landed and is fully verified below the VM line; this task is the half that needs real hardware virtualisation.

## Why this is a separate task

TASK-504 folded the gadget-enumeration wait into `startDaemonForPersona` so the primitive cannot hand back a daemon on an empty bus. Its ACs #1–#4 are done and proven: lint clean, typecheck 38/38, `@podkit/device-testing` unit suite 338 pass / 0 fail, and six new unit tests with an injected `SubprocessRunner` pin that the primitive actually polls rather than trusting `systemctl`.

Its AC #5 — `bun run test:vm` green, with the previously-racing files *confirmed* rather than assumed — could not be run on the Linux dev box. `bun run vm:status device` reports `missing` and the VM cannot be created there: `test-packages/lima/vms/podkit-device.yaml` declares `vmType: 'vz'` (Apple Virtualization.framework, macOS-only) and the host has no `/dev/kvm`, so the qemu fallback has no hardware virtualisation either. That gap is TASK-493's subject; this task just needs a host that already works.

## What changed, so you know what you are re-verifying

- `StartDaemonOpts.personaId: string` → `persona: DevicePersona`. The primitive waits for *this* persona's `vid:pid` in sysfs, plus `/dev/sg*` when the persona carries a `massStorageBackingFile`.
- `MountPersonaOpts.personaId`/`vendorId`/`productId` → `persona`. Ten call sites updated.
- The waits moved to `runners/lima-enumeration.ts` and are **no longer exported** from `@podkit/device-testing`.
- Four e2e files dropped their own wait: `pre-sync-sweep`, `doctor-device-types`, `doctor-output-contract`, `discovery-reconciliation`.

## How to run it

```bash
bun run harness:status          # VM, binaries, systemd unit, kernel modules
bun run test:vm                 # auto-runs vm:install (cached) + vm:doctor first
```

`test:vm` now installs the in-VM binary itself, so a plain run should be enough from a healthy harness.

## What to actually look at

Do not just read the exit code. The failure this guards against is silent: a daemon on an empty bus makes `podkit device scan` return zero devices, which reads as a legitimate result. So a green run proves less than it looks like it does unless you check the three files that previously raced.

Pay attention to:

- `pre-sync-sweep.e2e.test.ts` — echo-mini daemon stays up across the whole suite; it dropped a `waitForScsiGenericEnumeration` that ran before `mountEchoMini()`.
- `doctor-device-types.e2e.test.ts` and `doctor-output-contract.e2e.test.ts` — both mount echo-mini once per group off a long-lived daemon.
- `discovery-reconciliation.e2e.test.ts` — the replug loop (start/stop ×3). The one most likely to expose a regression, since it re-binds three times in a row.
- `dual-daemon-lifecycle.e2e.test.ts` — two personas concurrently. Its own `/dev/sg*` count poll is now downstream of the primitive's waits; confirm the `baseline + 2` assertion still holds rather than passing vacuously.

## Known weakness worth confirming or discarding while you are there

`waitForScsiGenericEnumeration` polls `ls /dev/sg* | head -n1`, which matches **any** SCSI generic node — including the VM's boot disk and a node left behind by a previous persona. `dual-daemon-lifecycle` already knows this and counts against a pre-start baseline for exactly that reason. So that wait can return before the persona's own node exists.

It should not be load-bearing: the USB wait *is* persona-specific and runs first. But `mountPersona`'s `/dev/sd<x>` discovery runs immediately after it, so if you see a mount-discovery failure, this is the first thing to suspect. File it separately with evidence rather than patching it here.

## Unblocks

TASK-506 (the retry-policy decision) wants the genuine flake causes fixed *and* shown to hold before `retry = 0` goes in. This is the last piece of that evidence for the VM surface.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `bun run test:vm` passes on the macOS harness host, with the run output recorded in the notes (not just 'it passed')
- [x] #2 The four converged files — pre-sync-sweep, doctor-device-types, doctor-output-contract, discovery-reconciliation — are each confirmed green by name rather than assumed from a green suite
- [x] #3 The replug loop in discovery-reconciliation is confirmed to still see exactly one device per cycle across all three cycles
- [x] #4 dual-daemon-lifecycle's `baseline + 2` sg-count assertion is confirmed to still bind rather than pass vacuously now that the primitive waits first
- [x] #5 A rerun under host load (or repeated runs) shows the VM suite is no less stable than before the change, so the wait was not traded for a new timeout
- [x] #6 The non-persona-specific `ls /dev/sg*` weakness is either confirmed harmless in practice or filed as its own task with the failing evidence
- [x] #7 TASK-504's AC #5 is recorded as satisfied (or the regression it exposes is filed and linked)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Outcome

TASK-504's enumeration guarantee holds in the device VM. Confirmed across three `test:vm` runs on Mavis, two of them under host load. One unrelated flake surfaced (filed as TASK-510) and one latent guarantee gap was measured and filed (TASK-509).

## Harness had to be rebuilt first

`podkit-device` was wedged: VZ reported `running`, `serialv.log` was 0 bytes (no guest console output at all), and sshd never answered on `192.168.5.15:22` across two full 10-minute `vm:up` attempts — including after a `limactl stop -f`. Destroyed and reprovisioned via `vm:destroy device --yes` + `harness:setup`; the fresh disk booted first time and `harness:status` came back green on all 10 checks. Matches the known mac-sleep corruption mode.

## Runs

| Run | Caches | Host load | device-testing | e2e-vm-tests | Result |
|-----|--------|-----------|----------------|--------------|--------|
| 1 | normal | idle | 38 pass / 0 fail (53.4s) | 194 pass / 44 skip / 0 fail (230.2s) | green |
| 2 | `--force` | 6 busy loops / 12 cpus | **1 fail** | not reached | see TASK-510 |
| 3 | `--force` | 6 busy loops / 12 cpus | 38 pass / 0 fail (48.2s) | 194 pass / 44 skip / 0 fail (202.2s) | green |

Run 3 was *faster* than the idle run 1 on both packages, so the centralised wait did not trade a race for timeout pressure (AC #5).

## The named files, confirmed individually (AC #2, #3, #4)

Parsed per-file from both green runs rather than inferred from the suite total. Identical in run 1 and run 3, and **no skips** in any of them — so none passed by being absent:

- `pre-sync-sweep.e2e.test.ts` — 4 pass
- `doctor-device-types.e2e.test.ts` — 6 pass
- `doctor-output-contract.e2e.test.ts` — 13 pass
- `discovery-reconciliation.e2e.test.ts` — 2 pass, including `replug cycle (start/stop ×3) — scan shows exactly one entry each cycle` (2699ms / 2856ms). The `expect(apple.length).toBe(1)` is inside the loop body, so a pass is a per-cycle assertion, not an end-state one — all three cycles saw exactly one device.
- `dual-daemon-lifecycle.e2e.test.ts` — 1 pass (3407ms / 3589ms)

## The `baseline + 2` assertion binds (AC #4)

Measured directly in the VM rather than argued:

```
baseline_sg_nodes=0          (with no daemon running)
after_start_sg_nodes=1       (echo-mini)
after_both_sg_nodes=2        (+ ipod-video-5g-iflash-1tb)
after_stop_sg_nodes=0
```

Baseline is captured before either `startDaemonForPersona`, and is 0, so `>= baseline + 2` requires both personas' nodes to actually appear. Not vacuous.

Incidental finding: the boot disk contributes **no** sg node on this image (virtio, `/dev/vda`), which contradicts the rationale comment in `dual-daemon-lifecycle.e2e.test.ts` ("the boot disk already contributes sg nodes"). The delta approach is still right; the stated reason is wrong. Correcting it is AC #5 of TASK-509.

## The `ls /dev/sg*` weakness (AC #6) — real, filed as TASK-509

Measured both halves:

*Single persona — the wait is load-bearing and works.* `usb_match_ms=449`, `persona_sg_block_ms=1451`, and `generic_ls_sg_first_true_ms=1451` (identical, since with baseline 0 only the persona can satisfy it). So it buys a real ~1.0s over the USB wait, and `mountEchoMini` — which is itself persona-specific, walking `/sys/class/scsi_generic/sg*` for `071b:3203` — would race without it.

*Second concurrent persona — the wait is worth nothing.* With echo-mini settled, starting `ipod-video-5g-iflash-1tb`: the generic probe is already true from echo-mini's node, while B's own node appears 1474ms later. `startDaemonForPersona` therefore returns ~1.5s early for B while its docstring claims otherwise.

Not currently load-bearing broken: `dual-daemon-lifecycle` is the only concurrent caller and counts its own baseline; every mount-bearing suite runs one mass-storage persona at a time. The stale-node variant is closed in practice (`after_stop_sg_nodes=0`). Filed as **TASK-509** rather than patched here, per this task's instruction.

## Unrelated failure found under load — TASK-510

Run 2 failed in backing-file synthesis for `ipod-5g-video-mbr-part`, before any daemon or enumeration is involved. The error was `(no output, exit=1)` because the build script silenced `sfdisk` and `mkfs.vfat` with `>/dev/null 2>&1`.

Not reproducible in isolation: 12 sequential build cycles, then 3 concurrent workers × 15 cycles idle, then the same under 10 host busy loops — 0 failures, 0 leaked loop attachments, disk at 15%.

Rather than guess, this task landed the diagnosability fix so the next occurrence explains itself: `loudOnFailure()` captures stderr into a shell variable (`2>&1 >/dev/null`, order-sensitive) and echoes it on failure, leaving stdout clean for `parseBuildReport`. Verified in the VM on both paths — success discards the `mkfs.fat 4.2` banner, failure prints `mkfs.vfat failed (exit 1): mkfs.vfat: unable to open /tmp/does-not-exist-at-all: No such file or directory`. The investigation itself is **TASK-510**.

## Drive-by: the lint gate was broken on this host

`bun run lint` failed with 7 shellcheck findings in `packages/virtual-ipod-app/src-tauri/target/release/bundle/dmg/bundle_dmg.sh` — a vendored `create-dmg` artefact inside a git-ignored Rust build directory. `scripts/lint-shell.mjs` discovered scripts by walking the tree against a hardcoded skip list that had no entry for `target/`, so the gate broke on any machine that had built the Tauri app locally. Discovery now asks git (`ls-files --cached --others --exclude-standard`), which covers every ignored build directory without naming any, and keeps not-yet-staged scripts in scope; the walk remains as a fallback. 28 scripts scanned, clean.

## Verification

- `bun run lint` — clean (0 oxlint, 0 stderr-convention, 28 shell scripts no errors/warnings)
- `bun run typecheck` — 38/38
- `bun run test:unit --filter @podkit/device-testing` — 339 pass / 2 skip / 0 fail
- `bun run test:vm` — green idle and green under load (table above)
<!-- SECTION:NOTES:END -->
