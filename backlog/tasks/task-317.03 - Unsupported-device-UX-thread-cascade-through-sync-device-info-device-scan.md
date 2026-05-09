---
id: TASK-317.03
title: 'Unsupported-device UX + thread cascade through sync, device info, device scan'
status: To Do
assignee: []
created_date: '2026-05-09 15:20'
updated_date: '2026-05-09 15:42'
labels:
  - ux
  - safety
  - architecture
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: high
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Combined task: redesign behavior across multiple commands so unsupported devices (hashAB nano 6G/7G, iOS iPod touch / iPhone / iPad, shuffle 3G/4G, etc.) get clear, consistent, and safe UX — and so the cascade identity primitive is the only source of truth across `device add`, `device scan`, `device info`, `sync`. The two clusters (unsupported-device UX + cascade through commands) are merged because they touch the same code paths and the same wording, and splitting would force one to land before the other can be coherent.

## Current behavior (broken)

1. **`device add` on a hashAB nano (e.g., nano 7G blue)**: hard-refuses with `iPod nano (7th Generation) is not supported by podkit (libgpod cannot sync this generation).` Two problems: (a) leaks `libgpod` into user-facing copy; (b) per the user's preference, the user should be told the device is unsupported but allowed to proceed with the add (a warn-but-allow flow).
2. **`device add` on an iPod touch (iOS)**: fails generically with `No iPod devices found. Make sure your iPod is connected, or specify a path explicitly with --path.` The unsupported-device messaging that exists in the codebase (and surfaces only in `device scan`) never reaches the user. Reason: `device add` is disk-scan-based; iOS devices have no mass-storage mount so they're invisible. The friendly explanation message must be reachable from `device add` too.
3. **`device scan`** detects unsupported devices but the entry header still says `Unknown iPod (USB only)` even when podkit has resolved the model name (e.g., `iPod touch (5th generation)`). Cosmetic but confusing.
4. **`sync --dry-run` on a hashAB nano** generates a 4,360-track plan despite the device being unsupported. Should refuse cleanly with the same canonical unsupported-device message used elsewhere.
5. **`sync` emits `Could not identify iPod model from the on-disk identity files`** even when SysInfoExtended is present and `doctor` correctly identifies the device. Sync's identity resolution is divergent from the cascade primitive in `@podkit/core`. Sync currently bypasses `assessIpodIdentity` / `resolveIpodModel`.
6. **`device info`** still uses libgpod for identity (around `commands/device.ts:2657`). Should compose with the cascade.
7. **`doctor` on a hashAB nano** reports `iTunesDB not found` and suggests `podkit device init`. **Running init on a hashAB device that uses SQLiteDB could corrupt on-device state.** Doctor must detect unsupported generations and refuse to suggest mutating repairs. Surface the canonical unsupported-device message instead.

## Target behavior

- **Single source of truth for "is this device supported?"**: `resolveIpodModel(bag).notSupportedReason` (already exists). All commands gate on this.
- **`device add`**: when unsupported, show the canonical message AND offer to add anyway with explicit confirmation. The user gets the choice, not a hard block. Wording: never names libgpod; uses model name and reason cleanly.
- **`device add` for iOS**: enrich the device-detection path so iOS devices reach `device add`. Likely: if disk scan finds nothing but USB enumeration finds an Apple-vendor device with an unsupported PID, surface that case.
- **`device scan`**: header shows resolved model name when known.
- **`sync`**: refuses cleanly on unsupported devices with the canonical message. For supported devices, identity resolution composes with `resolveIpodModel(bag)` — no more "Could not identify" warning when SIE is present.
- **`device info`**: composes with cascade. No libgpod-derived identity in the user-facing display path.
- **`doctor`**: when generation is unsupported, suppress all suggestions that would mutate device state (`device init`, `repair sysinfo-consistency`, etc.). Surface the canonical message instead.

## Acceptance Criteria
<!-- AC:BEGIN -->
See AC list. The unsupported-device message wording should be consistent across all commands; centralize it in `@podkit/devices-ipod` or similar so the wording lives in one place.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 `resolveIpodModel(bag).notSupportedReason` is the single source of truth for unsupported-device gating across `device add`, `device scan`, `device info`, `sync`, `doctor`. No command re-implements the check.
- [ ] #2 User-facing copy never mentions `libgpod`. Replace existing strings with neutral phrasing like 'this generation is not yet supported by podkit'.
- [ ] #3 `device add` on an unsupported nano (e.g., nano 7G blue): displays the canonical message, asks `Add anyway? [y/N]`, and on `y` writes a config entry that records the device as unsupported. Default is `N`. With `--yes`, default flips to add.
- [ ] #4 `device add` on an iOS device (iPod touch): displays the same canonical message instead of the generic 'No iPod devices found'. Detection path must consult USB enumeration when disk scan finds nothing.
- [ ] #5 `device scan` entry headers display the resolved model name when known (e.g., `iPod touch (5th generation)`), not `Unknown iPod (USB only)`.
- [ ] #6 `sync --dry-run` on an unsupported device refuses with the canonical message and a clear suggestion. No track plan is generated.
- [ ] #7 `sync` on a supported device with SysInfoExtended present resolves identity via the cascade; does NOT emit `Could not identify iPod model from the on-disk identity files`.
- [ ] #8 `device info` composes with the cascade. The libgpod-derived identity call site at `commands/device.ts` (the line that currently uses `info.device.modelName`) is replaced with `resolveIpodModel(bag).displayName`.
- [ ] #9 `doctor` on an unsupported device suppresses suggestions that would mutate device state (`device init`, `--repair sysinfo-consistency`, etc.). Surfaces the canonical message instead.
- [ ] #10 Unit tests added for each command path: cascade-resolves-supported, cascade-resolves-unsupported, per-command refusal/allow path. Use injected USB + transport fakes.
- [ ] #11 Real-hardware test: nano 7G blue + iPod touch + nano 4G + nano 2G. Specifically: `device add` on nano 7G blue (warn-allow flow); `device add` on iPod touch (canonical iOS message); `device scan` with iPod touch (header label); `sync --dry-run` on nano 7G (refuse) + nano 4G (regression); `device info` on nano 4G (regression).
- [ ] #12 Wording centralized: the canonical unsupported-device message lives in one helper in `@podkit/devices-ipod` (or similar). All consumers import + render.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Observed during m-18 sweep on real Echo Mini hardware. The current `device add` auto-detect path (the stop-gap before TASK-262 wizard lands) has small bugs that compound with the wider device-add UX. Whether to fix here or fold into the wizard work is a judgment call — some of these only manifest when no `-d` is supplied, which the wizard will replace anyway:

1. `podkit device add` (no args) fails with `Missing required --device flag. Usage: podkit device add -d <name>` — the auto-detect-suggest path requires `-d` even though it doesn't use the name yet.
2. Duplicate output: `Detected Echo Mini via USB.` followed shortly by `Detected echo-mini device — add with --type echo-mini --path <mount-point>`. Two emit sites for the same finding.
3. The auto-detect-suggest path exits with code 1 — it's an informational message ('here's the command you should run'), not an error. Should exit 0 (or the success-with-instructions code, if there is one).
4. Suggested command embeds `<mount-point>` placeholder rather than the actual mount path(s) discovered. The detection scan already knows the mount paths.

If TASK-262 wizard subsumes this whole code path, leaving these as-is is acceptable. Flag for the implementer.
<!-- SECTION:NOTES:END -->
