---
id: TASK-317.10
title: 'libxml2 stderr leak: capture or suppress parser errors at the call boundary'
status: To Do
assignee: []
created_date: '2026-05-09 16:43'
labels:
  - native-bindings
  - ux
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: low
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
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

## Fix

Capture or suppress libxml2's stderr at the call boundary in `@podkit/ipod-firmware`'s plist parser. macOS uses libxml2 via koffi; Linux likely the same. Either redirect FD 2 around the parse call, or set libxml2's error handler to a silent function via `xmlSetGenericErrorFunc` / `xmlSetStructuredErrorFunc`.

The structured-error route is preferred — it lets us capture errors as data (line/column/severity) and surface them through podkit's existing logger if needed, instead of swallowing silently.

## Companion task

Split out from the original TASK-317.01. The phantom-device-scan bug remains in TASK-317.01; this task addresses only the libxml2 stderr leak.

## Acceptance Criteria
<!-- AC:BEGIN -->
See AC list.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 Corrupting a SysInfoExtended file (truncate mid-XML) on a connected iPod, then running `doctor`, produces no `parser error :` lines on stderr. The doctor output's `✗ SysInfoExtended consistency` failure remains intact and reaches the user via the normal output sinks.
- [ ] #2 Parse errors, when they occur, are surfaced to podkit's logger (debug level by default; promotable via `-v`) instead of being silently swallowed. Reason: future debuggability outweighs the cost of one logger call.
- [ ] #3 Unit test added: feed a deliberately malformed XML to the plist parser; assert no stderr output is produced (capture stderr in the test) and that the parser returns `null` / throws as appropriate.
- [ ] #4 Real-hardware run: plug mini 2G, corrupt its SysInfoExtended (truncate to ~500 bytes mid-XML), run `doctor`, confirm clean stderr; unplug.
- [ ] #5 Regression: the corrupt-SIE test from §3b on mini 2G still passes (graceful failure, falls back to SysInfo for identity).
<!-- AC:END -->
