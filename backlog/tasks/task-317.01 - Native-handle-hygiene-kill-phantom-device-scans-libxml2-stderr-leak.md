---
id: TASK-317.01
title: 'Native-handle hygiene: kill phantom-device scans + libxml2 stderr leak'
status: To Do
assignee: []
created_date: '2026-05-09 15:18'
labels:
  - safety
  - native-bindings
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: high
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two native-binding leaks discovered during the m-18 sweep, each surfacing as a user-visible bug.

## Bug 1: Phantom devices in `device scan` after plug/eject cycles

After a session of plugging and ejecting multiple iPods, `podkit device scan` reports phantom "Unknown iPod (USB only)" entries even when no iPods are plugged in (`system_profiler SPUSBDataType` confirms zero Apple-vendor USB devices). Each phantom suggests `podkit device init` as remediation — a destructive operation. **A user following the suggestion would target whatever bus/devnum the scanner thinks the iPod is at, possibly mutating an unrelated device.**

Reproduction: in a single shell session, plug + run `device add` + run `doctor` + eject across 5–7 iPods. Then unplug everything and run `podkit device scan`. Phantoms appear, count roughly matches the number of devices cycled.

Likely cause: the `usb` npm package's `getDeviceList()` cache, or libgpod's enumeration path, retains handles after the device is unmounted/unplugged. Investigate both. Fix may require an explicit teardown call after each enumeration, or skipping cached results when the underlying device address is no longer present.

## Bug 2: libxml2 parser errors leak to stderr

When a SysInfoExtended file on disk is corrupt (truncated mid-XML), `doctor` reports the failure correctly but **two libxml2 stderr lines leak through** before the doctor output:

```
parser error : Premature end of data in tag key line 24
<key>Max
        ^
parser error : Premature end of data in tag key line 24
<key>Max
        ^
```

These are emitted directly by libxml2 (via koffi) and bypass podkit's `OutputContext` sinks. The duplication is because two consumers of the XML (`readSysInfoExtended` + the `sysinfo-consistency` check) each invoke the parser independently.

Fix: capture or suppress libxml2's stderr at the call boundary in `@podkit/ipod-firmware`'s plist parser. macOS uses libxml2 via koffi; Linux likely the same. Either redirect FD 2 around the parse call, or set libxml2's error handler to a silent function.

## Acceptance Criteria
<!-- AC:BEGIN -->
See AC list. Real-hardware verification required.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 After a plug/eject cycle of 3+ iPods, running `device scan` with nothing plugged in shows zero phantoms (only the 'Not detected' list). Verified on real hardware.
- [ ] #2 Corrupting a SysInfoExtended file (truncate mid-XML) on a connected iPod, then running `doctor`, produces no `parser error :` lines on stderr. The doctor output's `✗ SysInfoExtended consistency` failure remains intact.
- [ ] #3 Unit test added: simulate a stale-handle scenario in the device-scanner's USB enumeration helper and assert phantoms aren't reported. Inject a fake USB binding for testability.
- [ ] #4 Unit test added: feed a deliberately malformed XML to the plist parser; assert no stderr output is produced (capture stderr in the test).
- [ ] #5 Real-hardware run: plug + add + eject mini 2G, nano 4G, nano 7G #1; unplug all; run `device scan` and confirm clean output. Then plug only mini 2G, corrupt its SysInfoExtended, run `doctor`, confirm clean stderr.
- [ ] #6 Regression: the corrupt-SIE test from §3b on mini 2G still passes (graceful failure, falls back to SysInfo for identity).
<!-- AC:END -->
