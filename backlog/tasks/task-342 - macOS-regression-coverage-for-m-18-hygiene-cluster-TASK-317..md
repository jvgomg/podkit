---
id: TASK-342
title: macOS regression coverage for m-18 hygiene cluster (TASK-317.*)
status: Done
assignee: []
created_date: '2026-05-16 22:31'
updated_date: '2026-06-15 23:00'
labels:
  - device-capability-architecture
  - macos
  - regression
  - follow-up
milestone: m-18
dependencies: []
priority: medium
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Catalogue of macOS-specific scenarios from the m-18 TASK-317 hygiene cluster that need automated regression coverage. These don't fit in TASK-341 (Linux VM coverage) because they exercise paths that only manifest on macOS: `system_profiler`, IOKit, `diskutil`, HFS+ as a supported filesystem, BSD partition naming (`disk2s1`), and the macOS-side discovery pipeline.

Hardware verification still goes through TASK-319 (linka) and a manual macOS spot-check; this task covers what can be automated against macOS dev machines (CI runners + local) via the persona-driven test harness, NOT via real-hardware tests on the dev machine.

## Coverage matrix

### TASK-317.12 — HFS+ on macOS unchanged (regression target)
- `device add --path` against an HFS+ iPod on macOS → succeeds (refusal is Linux-gated only).
- `device scan` with HFS+ iPod on macOS → renders normally with full readiness; no ⚠ Filesystem-not-supported warning.
- `sync --dry-run` on HFS+ iPod on macOS → produces a coherent plan.
- Filesystem detection: `diskutil info` parser surfaces `filesystem: 'hfsplus'` (or whatever the platform-probe normalises it to) but the `isFilesystemUnsupportedHere('hfsplus', 'darwin')` predicate returns `false` — pinned by unit tests, but also worth an integration assertion against the mock manager surface.

### TASK-317.11 — discovery reconciliation on macOS
- macOS `system_profiler` shape: `bsd_name` carries the BSD device identifier. Sometimes whole disk (`disk2`), sometimes partition (`disk5s2`). Reconcile must strip partition suffix on both sides.
- Single iPod via macOS pipeline → exactly one entry (regression — macOS path was working pre-fix; must not regress).
- macOS pipeline with synthetic `bsd_name: disk5s2` on USB side AND `identifier: disk5s2` on block side → folds to one record via `disk-identifier` match (NOT the worker's first-cut buggy version that stripped only one side).

### TASK-317.04 — SysInfo modelnum mismatch detection on macOS
- TERAPOD persona on macOS (`diskutil` reports the partition; SysInfo XML parsed from disk fixture) → check fires `warn`; repair writes backup + rewrites the file. macOS path uses the same diagnostics framework as Linux; primary smoke is "framework still drives the check on macOS".

### TASK-317.03 — unsupported cascade on macOS
- `device add` against a hashAB nano on macOS → warn-allow prompt (decline/accept/--yes). Same code path as Linux but worth a macOS-platform persona run.
- `device add` against iPod touch persona on macOS → canonical iOS message via the USB-classifier consult (no block device on macOS either for iOS).
- `sync --dry-run` against hashAB nano on macOS → refuses cleanly.
- `device info` against any persona on macOS → cascade displayName (not libgpod modelName).
- `doctor` against unsupported persona on macOS → suppress mutating repairs; canonical message primary.

### TASK-317.08 — doctor consistent sections on macOS
- `doctor -d <iPod-persona>` on macOS → `System` / `Device Readiness` / `Database Health` in order.
- `doctor -d <echo-mini-persona>` on macOS → `System` (Codec Encoders, Video Encoder; iPod Firmware Inquiry Methods absent via `applicableTo: ['ipod']`); `Database Health` (Orphan Files Mass Storage); no `Device Readiness` section.
- `doctor --no-system -d <iPod-persona>` on macOS → only device sections render.
- `doctor --scope system` on macOS → only System renders.

### Scope refactor + consolidations on macOS
- macOS JSON envelope shape parity with Linux: 3-way `scope`, no `category`, discriminated `unsupported` payload.
- Richer `DeviceConfig.unsupported` round-trip on macOS TOML writer.

## What's NOT in this task

- TASK-317.13 (udev rule USB scope) — Linux-only; not applicable on macOS.
- TASK-317.14 (orchestrator EACCES messaging) — Linux EACCES path; macOS uses IOKit with different permission semantics (root not typically required for SCSI/USB). Worth a smoke test that the formatter doesn't crash when fed macOS-shape transport results, but no specific macOS scenario to assert.
- TASK-317.15 (volumeUuid defensive) — same predicate fires on both platforms; assertion via the cross-platform unit tests is sufficient.
- Real hardware sweeps on macOS → TASK-312 (done) + a manual spot-check before each release.

## Harness fit

Most scenarios are persona-driven and run inside the same unit/integration suite that already runs on macOS CI. The shape difference vs Linux is mostly:
- `PlatformDeviceInfo.identifier` carries `disk5s2` instead of `sdc1`.
- `EnumeratedUsbDevice.diskIdentifier` carries `disk5` (or sometimes `disk5s2`).
- `manager.isSupported` is `true` and `findIpodDevices` actually runs (instead of being mocked as it is on the Linux unit tests).

Use the persona-set's macOS-flavoured shapes; if a persona today only carries Linux-flavoured `PlatformDeviceInfo`, extend it with a sibling macOS shape. No new persona-creation expected — just persona-shape extensions.

## Out of scope here

- Linux scenarios → TASK-341.
- Real-hardware verification → TASK-319 + manual macOS sweep.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 TASK-317.12 (HFS+ regression on macOS): device add + scan + sync --dry-run + filesystem-policy predicate pinned via macOS-shape tests; HFS+ remains supported on macOS.
- [ ] #2 TASK-317.11 (reconcile on macOS): macOS system_profiler shape covered, including the `bsd_name: disk5s2` partition-level case on the USB side.
- [ ] #3 TASK-317.04 (modelnum mismatch on macOS): TERAPOD persona detection + repair runs under the macOS-platform diagnostic framework.
- [ ] #4 TASK-317.03 (unsupported cascade on macOS): device-add warn-allow, iOS path, sync refuse, device-info displayName, doctor suppress — all covered.
- [ ] #5 TASK-317.08 (doctor sections on macOS): iPod 3-section, mass-storage 2-section, --no-system, --scope system covered.
- [ ] #6 Scope refactor + consolidations: macOS JSON envelope shape parity with Linux pinned; richer config round-trip on macOS TOML.
- [ ] #7 Persona shapes extended to carry macOS-flavoured PlatformDeviceInfo where needed; no real-hardware test harness added to macOS dev machines.
- [ ] #8 All scenarios pass in macOS CI runner; tests are non-flaky under the persona-driven framework.
<!-- AC:END -->
