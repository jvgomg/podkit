---
id: TASK-479.14
title: 'Bound the cost of firmware probing — total deadline, memo, concurrency cap'
status: To Do
assignee: []
created_date: '2026-08-23 13:44'
labels:
  - identity
  - ipod-firmware
  - performance
milestone: m-18
dependencies:
  - TASK-479.07
parent_task_id: TASK-479
priority: high
ordinal: 251500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem: `timeoutMs` does not bound anything

An earlier draft proposed "a shorter `timeoutMs` for the display path" as the cost control. That does not work. `timeoutMs` is **per control transfer / per VPD subpage**, not total:

- `packages/ipod-firmware/src/inquiry/usb.ts:50` — `DEFAULT_TIMEOUT_MS = 0`, which is libusb-infinite; `:355` uses it when unset.
- `usb.ts:48, :368` — the page loop runs up to `MAX_PAGES = 0xffff`. Worst case is 65535 × `timeoutMs`.
- `scsi/index.ts:70` + `readAllVpdSubpages:115-136` — same shape, per subpage.

A device that keeps returning full 4096-byte pages **never times out at all**. Any claim of the form "an unreachable device costs one short timeout" is unprovable until a total bound exists.

This matters most on `doctor`: `doctor.ts:1250` → `preflightCascadeRefusal` → `assessRepairRefusal` (`repair-dispatch.ts:159`) runs the identity path before *every* iPod repair, ahead of the DB handle. It swallows errors (`:167-169`) — it cannot swallow a hang.

## Scope

### 1. Total deadline

Wrap `inquireFirmware` in a total wall-clock deadline (`AbortSignal` / `Promise.race`) for the probe path. Per-transport `timeoutMs` stays as a secondary bound. The constant is to be **measured** on real hardware — including an HDD-based classic that spins up — and pinned with a comment citing the measurement, not invented.

### 2. Memo — injected, not a module global

Per-process memoisation, keyed on USB serial when present and `bus:devnum` otherwise. Failures memoise too.

**Passed as a parameter, not a module-level singleton.** Both layers already accept injection (`assessIpodIdentity(mountPoint, opts?)` at `ipod-identity.ts:98-102`; `InquireOptions` at `orchestrator.ts:61-85`), so the whole benefit is available without the global. Precedent for module globals exists (`probe.ts:188-198` `clearProbeCache`, `device/manager.ts:17` `clearDeviceManagerCache`) but core has exactly two of them in total — it is a deliberate exception, not a default.

The memo helps almost nowhere: `sync`, `doctor`, `add`, `init` and `archive` each probe at most once per process. The only genuinely multi-probe process is `device scan`, which is why scan-scoped injection is the right shape.

### 3. Concurrency cap

`device scan` probes in parallel, capped at 4 concurrent. No unbounded `Promise.all` over the device list.

### 4. Short-circuit before the dynamic import

The common case — identity already resolved from disk — must return **before** `probeInquiryMethods` reaches its dynamic `import('usb')` (`probe.ts:97-104`). Otherwise every `sync` on a healthy device pays module-load cost for nothing.

## Honest cost model for the daemon

The daemon does not poll identity — `packages/podkit-daemon/src/device-poller.ts:287, 311-315` is `lsblk` + sysfs `idVendor` only, with a 2-poll debounce and one emit per device (`:345-349, 377-384`). No USB open.

But it shells `podkit sync --dry-run` then `podkit sync` (`sync-orchestrator.ts:254, 281`) — **two separate processes per plug event**, each paying its own probe, and `open-device.ts:297` re-resolves USB independently within each. A per-process memo is worthless there. State this in the ADR rather than implying one probe per plug event.

## Related

The no-transport path is already cheap: `probeLinuxScsi` (`probe.ts:128-162`) checks `/dev/sg*` readability first, `probeInquiryMethods` caches per process (`:188-198`), and `plan: 'none'` returns without touching a transport (`orchestrator.ts:224-225`). Docker without `/dev/bus/usb` costs one dynamic import and nothing more — but that should be measured, not assumed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A total wall-clock deadline bounds the probe path; a transport that keeps returning full pages is cut off rather than looping to `MAX_PAGES`
- [ ] #2 The deadline constant is pinned with a comment citing the hardware measurement it came from, including an HDD-based classic that spins up
- [ ] #3 Probe results, including failures, are memoised per process, keyed on USB serial with a `bus:devnum` fallback
- [ ] #4 The memo is passed as a parameter through the existing injection seams — no new module-level mutable state in core
- [ ] #5 `device scan` probes at most 4 devices concurrently; no unbounded `Promise.all` over the device list
- [ ] #6 A scan of 4 unreachable devices completes within a bounded multiple of the deadline, with a documented way to produce that state in the VM
- [ ] #7 A device that resolves identity from disk returns before `probeInquiryMethods` reaches its dynamic `import('usb')`
- [ ] #8 A probe interrupted by mid-operation device disconnect returns the pre-probe answer and does not throw
- [ ] #9 The no-transport path (Docker without `/dev/bus/usb`) is measured and costs nothing beyond the cached probe result
<!-- AC:END -->
