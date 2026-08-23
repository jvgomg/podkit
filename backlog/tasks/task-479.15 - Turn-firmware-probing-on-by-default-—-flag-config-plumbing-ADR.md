---
id: TASK-479.15
title: 'Turn firmware probing on by default — flag, config plumbing, ADR'
status: To Do
assignee: []
created_date: '2026-08-23 13:45'
labels:
  - identity
  - ipod-firmware
  - cli
  - adr
milestone: m-18
dependencies:
  - TASK-479.07
  - TASK-479.13
  - TASK-479.14
parent_task_id: TASK-479
priority: medium
ordinal: 254000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Scope

The behavioural-policy commit. Everything before it built an opt-in mechanism; this turns it on and takes responsibility for that.

Deliberately small and revertable on its own — which is what a policy change should be.

## The policy

podkit reads device firmware over USB **by default** whenever identity resolution has nothing better, across `scan`, `info`, `list`, `sync`, `add`, `archive` and `doctor`. The gate from TASK-479.07 means the common case (identity already on disk) costs nothing.

## Opt-out

`--no-firmware-probe` plus `PODKIT_NO_FIRMWARE_PROBE=1`.

Framing matters: this is a **user-facing** flag for slow or flaky buses, hosts where USB access is unwanted, and devices that misbehave when probed. Test-speed relief is a secondary beneficiary, not the justification — `documents/architecture/conventions.md:170-187` says test seams belong behind `__PODKIT_DEV_HOOKS__`, never an env-var sniff on a production path.

Consequently the env var is parsed in the CLI config layer (`packages/podkit-cli/src/config/loader.ts`) and threaded to core as an option. **Core reads no environment variable.** Core has no `PODKIT_*` read on any production path today — the only occurrence is `dev/hooks.ts:62, :95`, inside the compile-time guard.

Commander's `--no-X` synthesises a `true` default; filter via the existing `getOptionValueSource` helper at `packages/podkit-cli/src/utils/option-source.ts:45-48` before forwarding to the config layer.

The flag needs a shell-completion entry — see `agents/shell-completions.md`.

## Test defaults

Host e2e runs with `PODKIT_NO_FIRMWARE_PROBE=1`. Those tests run against dummy iPods with no USB behind them, so every probe is a guaranteed slow failure and pure test tax.

The e2e-shared CLI runner **already supports env injection** — `test-packages/e2e-shared/src/cli-runner.ts:54-55` declares `env?`, merged at `:152-158`, inherited by `runCliJson`. Set the default once at `:152` before the `...options.env` spread rather than threading call sites.

Do **not** set it via a shell or turbo script: `test-packages/device-testing/src/runners/local-linux.ts:44` inherits `process.env` into the VM-equivalent runner and would leak the opt-out into VM runs.

VM e2e runs at **production default** — `e2e-vm-tests` does not depend on `@podkit/e2e-shared` (it drives the CLI through `TestRuntime.run`, `test-packages/device-testing/src/runtime.ts:47-69`), so the split is structurally free. The FunctionFS gadget answers inquiry, which makes the VM the place the behaviour is actually provable.

## Hardware soak before this lands

"Read-only implies safe" is an assumption, not an established fact. `usb.ts:244` calls `device.open()` and issues vendor control transfers. Today inquiry only ever runs on explicit user action — `device add` confirmation (`add-firmware-inquiry.ts:95`), `doctor --repair` (`repair-dispatch.ts:162`), `device archive` (`archive.ts:399`). This task moves it onto `sync`'s pre-open gate (`sync.ts:744`): a control transfer to a device libgpod is about to write to.

Nothing in the repo establishes that probing a **mounted, in-use** iPod is harmless. Unmodelled risks: spin-up on HDD-based classics, driver-claim contention on macOS, a device that resets mid-operation.

Required before default-on: a soak on at least one HDD-based classic in addition to the nano 7G, confirming the device stays enumerable and mounted, and that a sync following a probe completes normally.

## ADR

A behavioural policy with permission, cost and privacy dimensions, which also changes what `--repair sysinfo-extended` is *for*. ADR-024 (device access tiers) is adjacent but not the same decision.

The ADR must state the daemon's real cost model honestly: two shelled processes per plug event (`sync --dry-run` then `sync`, `sync-orchestrator.ts:254, 281`), each paying its own probe. A per-process memo does not help there.

## Docs

- `documents/architecture/device/identity-support-matrix.md`
- Consider lifting "read, don't write, to know" into `documents/principles/`
- One changeset, **minor**, covering `podkit` and `@podkit/core`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Firmware probing is on by default across `scan`, `info`, `list`, `sync`, `add`, `archive` and `doctor`, gated so a device with identity on disk touches no transport
- [ ] #2 `--no-firmware-probe` and `PODKIT_NO_FIRMWARE_PROBE=1` disable probing everywhere
- [ ] #3 The env var is parsed in the CLI config layer and threaded to core as an option; core reads no environment variable on any production path
- [ ] #4 The Commander `--no-X` synthesised default is filtered via `getOptionValueSource` and never reaches the config layer
- [ ] #5 `--no-firmware-probe` appears in shell completions
- [ ] #6 Host e2e defaults to `PODKIT_NO_FIRMWARE_PROBE=1` via the existing `cli-runner.ts` env merge — not via a shell or turbo script that would leak into VM runs
- [ ] #7 VM e2e runs at production default and proves the live path end to end
- [ ] #8 Hardware soak on an HDD-based classic: probe on a mounted, in-use device leaves it enumerable and mounted, and a following sync completes normally
- [ ] #9 An ADR records the read-firmware-by-default policy, its effect on what `--repair sysinfo-extended` is for, and the daemon's two-processes-per-plug-event cost
- [ ] #10 `documents/architecture/device/identity-support-matrix.md` is updated
<!-- AC:END -->
