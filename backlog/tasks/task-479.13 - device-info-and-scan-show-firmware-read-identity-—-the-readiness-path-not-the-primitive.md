---
id: TASK-479.13
title: >-
  device info and scan show firmware-read identity — the readiness path, not the
  primitive
status: To Do
assignee: []
created_date: '2026-08-23 13:44'
labels:
  - identity
  - ux
  - ipod-firmware
milestone: m-18
dependencies:
  - TASK-479.07
parent_task_id: TASK-479
priority: high
ordinal: 250500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## This is the task that closes the user's complaint

Observed on real hardware 2026-08-17. An iPod nano 7G (16GB Green, serial `DCYN83SFF0GQ`) connected over USB displays as:

```
Model:          iPod nano (7th Generation)
```

while the same device's serial — which resolves to `D478`, 16GB Green — is readable from firmware over USB at that moment. The only way to make podkit show it is `doctor --repair sysinfo-extended`, which *writes a file to the user's device* purely so a later read can display a nicer name.

The owner's reaction, verbatim: "It's frustrating that we must write the SysInfoExtended file for correct info to show for the device."

## The trap this task exists to avoid

An earlier draft of the epic assumed `device info` resolves identity through `assessIpodIdentity`, and planned to fix display by enriching that primitive. **It does not.** Verified:

- **`device info`** — `open-device.ts:279-312` + `discoverConnectedDevices`/`checkReadiness`. `info.ts:549` merely *mentions* `assessIpodIdentity` in a comment; TASK-479.03 removed the call.
- **`device scan`** — `scan.ts:239-247` → `core.discoverConnectedDevices` → `checkReadiness`. Disk identity comes from `checkSysInfo` (`packages/podkit-core/src/device/readiness/stages/sysinfo.ts:76-90`), which does its own `readSysInfoExtended` + `resolveIpodModel`.
- **`device list`** — `list.ts:145-161` resolves via libgpod `deviceFromMountPoint` → `resolveIpodModel({ modelNumStr, libgpodGeneration })`. Weaker than either other path.

So the live rung has to reach the **readiness pipeline**, not just the primitive. Re-pointing `info`/`scan` back at `assessIpodIdentity` was considered and rejected — TASK-479.03 deliberately moved them off it.

## Scope

1. `checkSysInfo` (`readiness/stages/sysinfo.ts`) gains the live rung from TASK-479.07, subject to the same single-predicate gate and threaded through the same opt-in option. Probing stays off by default here too — TASK-479.15 turns it on.
2. `device info` prints an `Identity source` row (a distinct summary row, not a suffix on the Model line) and emits `identitySource` in JSON output.
3. `device list`'s libgpod-derived resolution is brought onto the same cascade, or explicitly documented as the weakest path with a reason.

## Output shape correction

The original draft said "`identitySource` field in `--format json`". `--format` does not exist on `info`/`scan`/`list` — they take the **global `--json`** (`packages/podkit-cli/src/main.ts:38`). `--format` exists only on `doctor`, `collection`, `device music` and `device video`.

## The `' (USB)'` lie must be fixed here

`packages/podkit-cli/src/commands/device-scan-render.ts:213`:

```ts
const modelSource = displayModel?.source === 'usb' ? ' (USB)' : '';
```

That is already a user-visible provenance suffix rendered off `IpodModel.source` — and `synthesizeFromGeneration` (`packages/devices-ipod/src/resolve.ts:67`) hardcodes `source: 'usb'` for **familyId** and **libgpodGeneration** resolutions too, not just productId. So a firmware-live model that happens to resolve via familyId would render "` (USB)`" — the exact provenance confusion the new `identitySource` field exists to prevent.

Fix the renderer (or `synthesizeFromGeneration`) rather than documenting the inaccuracy. This is pre-existing, but it becomes actively misleading the moment a second provenance axis exists.

## Verification

Unit + VM e2e with probing explicitly enabled. Hardware confirmation on the nano 7G is the acceptance moment for the epic's original complaint — log it in the task, but keep the CI-provable criteria separate so this can close without hardware in hand.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `checkSysInfo` resolves identity from live firmware when the gate fires, using the internal module from TASK-479.07 — probing still off unless the caller opts in
- [ ] #2 `device info` on a probing-enabled run shows model number, capacity and colour for a device whose identity is absent from disk but readable from firmware
- [ ] #3 `device info` prints a distinct `Identity source` summary row, not a suffix on the Model line
- [ ] #4 `identitySource` appears in the global `--json` output for `info` and `scan` — not `--format json`, which these commands do not have
- [ ] #5 `device-scan-render.ts`'s ` (USB)` suffix no longer fires for models resolved from familyId, libgpodGeneration or live firmware
- [ ] #6 `device list` either resolves through the same cascade or carries a documented reason for staying on the libgpod-derived path
- [ ] #7 No write occurs on `info`, `scan` or `list` — proven in the VM by snapshotting the gadget filesystem before and after, and by confirming the device is still enumerable and mounted afterwards
- [ ] #8 Enrichment failure degrades silently to the pre-probe answer; transport-error detail appears only at `-v`
- [ ] #9 Hardware log: nano 7G (16GB Green) displays its full variant with no SysInfoExtended on disk and no write performed
<!-- AC:END -->
