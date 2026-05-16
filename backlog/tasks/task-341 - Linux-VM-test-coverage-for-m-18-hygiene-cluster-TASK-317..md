---
id: TASK-341
title: Linux VM test coverage for m-18 hygiene cluster (TASK-317.*)
status: To Do
assignee: []
created_date: '2026-05-16 22:30'
labels:
  - device-capability-architecture
  - vm-testing
  - linux
  - follow-up
milestone: m-19
dependencies: []
priority: high
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Catalogue of behaviours from the m-18 TASK-317 hygiene cluster that need automated coverage in the Linux VM test harness. Each row maps a shipped behaviour to the synthetic device state (USB descriptors, on-disk files, host environment) and the assertion. Hardware verification is explicitly deferred to TASK-319; this is the VM-replayable substitute.

Local-test policy is "unit + integration in the main repo; do NOT add an e2e harness for device flows on macOS dev machines". Linux VM coverage is the authoritative end-to-end runtime check.

## Coverage matrix

### TASK-317.12 — HFS+ refusal on Linux (`4ee5e2b`)
- `device add --path` against HFS+ partition → exit non-zero, JSON `code: 'UNSUPPORTED_FILESYSTEM_ON_LINUX'`, text mentions HFS+ + docs URL, no config write.
- `device scan` with HFS+ iPod → ⚠ Filesystem-not-supported headline + 3 documented detail lines, no `Skipped` rows, no `device init` suggestion.
- Same iPod swapped to FAT32 → `device add` succeeds (regression).

### TASK-317.11 — discovery reconciliation (`f5d0082`)
- nano 3G FAT32 plugged + mounted → exactly one JSON entry; `matchedBy: 'serial'`.
- Two iPods simultaneously → two entries, no double-counts.
- Replug cycle (10×) → no phantom or duplicate entries.
- USB-only iOS device alongside matched iPod → both surface, no cross-contamination.

### TASK-317.13 — udev rule USB scope (`cdebfb3`)
- Fresh VM, no rule: `dd if=/dev/bus/usb/...` and `dd if=/dev/sg<N>` both EACCES for operator in plugdev.
- `doctor --repair udev-rule` + replug → `/etc/udev/rules.d/91-podkit-ipod.rules` with both `SUBSYSTEM=="scsi_generic"` and `SUBSYSTEM=="usb"` clauses for Apple vendor `05ac`; legacy `91-podkit-ipod-scsi.rules` removed; both devnodes `0660 root:plugdev`.
- Post-install: `doctor --repair sysinfo-extended -d <name>` via SSH → USB inquiry succeeds without sudo.
- Legacy-cleanup: pre-existing `-scsi.rules` removed on repair.

### TASK-317.14 — orchestrator EACCES messaging (`eed4126`)
- Both transports EACCES → stderr names USB + SCSI with their EACCES paths + remediation hint + `(re-run with -vv)` footer.
- USB EACCES + SCSI success → exits success; output identifies which transport succeeded.
- Plain USB success → no formatter output.
- `-vv` flag → libusb status codes / ioctl numbers; no re-run footer.

### TASK-317.15 — defensive volumeUuid (`6db8fb0`)
- `device add` with blank volumeUuid → refused with code `VOLUME_UUID_REQUIRED`; troubleshooting URL in message.
- Stale config with legacy `volumeUuid = "manual-XXX"` → defence-in-depth check refuses.
- Normal FAT32 with real UUID → adds successfully.

### TASK-317.04 — SysInfo ModelNumStr mismatch (`63a69d1`)
- TERAPOD-shape device (SysInfo says MA147, serial says V9M) → doctor surfaces ⚠ `sysinfo-modelnum-mismatch` with structured details.
- `--repair sysinfo-modelnum-mismatch` → backup written to `SysInfo.podkit-backup`; ModelNumStr rewritten; re-run passes.
- Healthy iPods (mini 2G, nano 2G/3G/4G/7G) → check passes silently.

### TASK-317.02 — doctor repair correctness (`a78e5fe` + `4a1d58d`)
- **Bug 1**: stale FireWireGUID → `--repair sysinfo-consistency` overwrites on-disk file (re-read confirms).
- **Bug 2**: fresh iPod no iTunesDB → `--repair sysinfo-extended` succeeds (no DB-open requirement).
- **Bug 3**: stale SIE failure → output mentions SIE + repair pointer; does NOT contain "artwork database is out of sync".
- **Bug 4**: truncated SIE → readiness shows "present but unparseable", not "not present".

### TASK-317.03 — unsupported-device cascade (`ec8dc85`)
- `device add` hashAB nano → prompt "Add anyway? [y/N]"; decline → no write; accept → config carries `unsupported = { kind = "unsupported-device", confirmedAt = <ISO> }`; `--yes` flips default.
- `device add` iOS device (no block device) → canonical unsupported message; not "No iPod devices found".
- `device scan` iOS → header shows resolved model name (e.g. "iPod touch (5th generation)").
- `sync --dry-run` unsupported → refuses cleanly, no track plan, non-zero exit.
- `sync` supported with SIE → output lacks "Could not identify iPod model".
- `device info` → rendered name from cascade displayName, not libgpod.
- `doctor` unsupported → no `device init` suggestion, no `--repair sysinfo-consistency` action, canonical message primary.
- `doctor --repair sysinfo-extended -d <unsupported>` (direct) → refused with `INCOMPATIBLE_DEVICE_TYPE`.

### TASK-317.08 — doctor consistent sections (`78b0c71`)
- iPod doctor → `System` → `Device Readiness` → `Database Health` in order.
- Echo Mini doctor → `System` (no iPod Firmware Inquiry — filtered via `applicableTo: ['ipod']`) + `Database Health` (Orphan Files Mass Storage); no empty `Device Readiness`.
- `--no-system` → only device sections render.
- `--scope system` → only System renders; no device resolution.

### Scope refactor + consolidations (`667d66b`, `679bec8`, `7d7a429`)
- `--scope device` → expands to `['device-readiness', 'database-health']`.
- JSON output: each check carries new 3-way `scope`; no `category` field; unsupported payload always discriminated-union shape; never bare string.
- Richer config: round-trip `{ kind, confirmedAt }`; legacy boolean coerced silently.

## Out of scope here
- Hardware-specific quirks (real iPod SysInfoExtended variances) — TASK-319.
- VM infrastructure scaffolding — TASK-322 + subtasks.
- macOS-only scenarios — separate m-18 task.

## Implementation hint

Existing persona registry at `packages/device-testing/src/personas/` already covers many scenarios (`ipod-nano-3g-black`, `ipod-touch-5g-unsupported`, `malformed-sysinfo`, `non-ipod-usb-disk`, `sony-*`). Extend the registry rather than re-inventing — add new personas only for genuinely-new states (HFS+ FAT swap, stale FireWireGUID, partition-level USB disk-identifier).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 TASK-317.12 (HFS+ refusal): device add + device scan + FAT32 regression scenarios covered as Linux VM tests.
- [ ] #2 TASK-317.11 (discovery reconciliation): single + dual + replug + USB-only-alongside scenarios covered.
- [ ] #3 TASK-317.13 (udev USB rule): no-rule + install + replug + legacy-cleanup scenarios covered.
- [ ] #4 TASK-317.14 (orchestrator EACCES messaging): both-EACCES, USB-EACCES-SCSI-success, plain-success, -vv verbose scenarios covered.
- [ ] #5 TASK-317.15 (volumeUuid defensive): missing-UUID + stale-manual-prefix + normal-FAT32 scenarios covered.
- [ ] #6 TASK-317.04 (sysinfo modelnum mismatch): TERAPOD detection + repair + healthy regression scenarios covered.
- [ ] #7 TASK-317.02 (doctor repair correctness): all 4 bugs covered (force-rewrite, DB-gate, failure-text routing, unparseable status).
- [ ] #8 TASK-317.03 (unsupported cascade): device-add warn-allow (decline/accept/--yes), iOS path, scan label, sync refuse, sync identity cascade, device-info displayName, doctor suppress, doctor direct --repair refusal — all covered.
- [ ] #9 TASK-317.08 (doctor consistent sections): iPod 3-section, mass-storage 2-section, --no-system, --scope system scenarios covered.
- [ ] #10 Scope refactor + consolidations: --scope device expansion + JSON envelope shape (3-way scope, discriminated unsupported, no category field) + richer-config round-trip + legacy boolean coercion covered.
- [ ] #11 Each VM test names the persona it uses (existing or new under `packages/device-testing/src/personas/`); new personas added only when no existing one suffices.
- [ ] #12 All scenarios pass in CI Linux VM runner + local `mise run test:linux`; none rely on macOS dev-machine state.
<!-- AC:END -->
