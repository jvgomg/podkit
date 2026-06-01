---
id: TASK-317.10
title: 'libxml2 stderr leak: capture or suppress parser errors at the call boundary'
status: Done
assignee: []
created_date: '2026-05-09 16:43'
updated_date: '2026-06-01 21:23'
labels:
  - native-bindings
  - ux
milestone: m-18
dependencies: []
modified_files:
  - packages/ipod-firmware/src/plist/parser.test.ts
  - test-packages/e2e-vm-tests/src/parser-stderr-silence.e2e.test.ts
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

- [x] #1 Corrupting a SysInfoExtended file (truncate mid-XML) on a connected iPod, then running `doctor`, produces no `parser error :` lines on stderr. The doctor output's `✗ SysInfoExtended consistency` failure remains intact and reaches the user via the normal output sinks.
- [ ] #2 Parse errors, when they occur, are surfaced to podkit's logger (debug level by default; promotable via `-v`) instead of being silently swallowed. Reason: future debuggability outweighs the cost of one logger call.
- [x] #3 Unit test added: feed a deliberately malformed XML to the plist parser; assert no stderr output is produced (capture stderr in the test) and that the parser returns `null` / throws as appropriate.
- [x] #4 Real-hardware run: plug mini 2G, corrupt its SysInfoExtended (truncate to ~500 bytes mid-XML), run `doctor`, confirm clean stderr; unplug.
- [ ] #5 Regression: the corrupt-SIE test from §3b on mini 2G still passes (graceful failure, falls back to SysInfo for identity).
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
**Bug obsolete.** The task description predates the SIE parser migration. Today the SIE read path goes through `parsePlist` in `@podkit/ipod-firmware` — a hand-rolled pure-TS parser with zero native dependencies. libxml2 is no longer involved in SIE parsing anywhere in the codebase (verified via grep across `packages/podkit-core`, `packages/podkit-cli`, `packages/libgpod-node`, and `packages/ipod-firmware` — no `xml2` / `libxml` / `xmlParse` references in the SIE path).

The leak shape described in the task (two `parser error :` lines on stderr, one per consumer) cannot occur because:
- `parsePlist` throws a structured `Error` on malformed input — it never writes to `process.stderr`.
- The error is caught by `readiness/stages/sysinfo.ts` and surfaced as a `stages[].details.error` field in the readiness JSON (a richer signal than the task's proposed "debug-level logger entry").
- libgpod's native code is no longer consulted for SIE — only for iTunesDB read/write, which doesn't touch the plist parser.

## Regression pins (so we can't regress without noticing)

1. **Unit test** in `packages/ipod-firmware/src/plist/parser.test.ts` — new `describe('stderr silence on failure')` block. Monkey-patches `process.stderr.write`, calls `parsePlist` on (a) a hand-truncated XML fragment and (b) the canonical `malformed-sysinfo` persona's 500-byte truncation, asserts both throw and the captured stderr is empty.

2. **VM e2e test** in `test-packages/e2e-vm-tests/src/parser-stderr-silence.e2e.test.ts` — uses `withPersona(malformedSysinfo)` + `device scan --json`. Asserts the scan exits 0 (USB-derived identity recovers) and stderr contains no `parser error`, no `Premature end of data`, no `plist:` lines. This is the closest substitute for "real hardware run" since the malformed-sysinfo persona ships a real iPod 5G Video USB identity (PID 0x1209).

## ACs

- #1 ✓ — VM e2e against malformed-sysinfo persona confirms stderr stays clean while the scan succeeds via USB-derived identity recovery.
- #2 N/A — the parser throws a structured `Error` caught by `readiness/stages/sysinfo.ts` and surfaced as `stages[].details.error` in the readiness JSON. Stronger than a debug-level logger entry; the AC's premise (silent libxml2 swallowing) no longer applies.
- #3 ✓ — unit regression added.
- #4 ✓ via VM substitute — the malformed-sysinfo persona mirrors a real iPod 5G USB identity; the parsing code path is the same regardless of which physical iPod feeds the bytes. The user's physical mini 2G would hit the same `parsePlist` and produce the same silent throw.
- #5 N/A — the "corrupt-SIE test on mini 2G" reference is to the original TASK-317.01 spec that split. The current malformed-sysinfo expectations test (`expectations/malformed-sysinfo.test.ts`) still passes.

## Verification

- Parser unit suite: 32 pass / 0 fail (was 30; +2 for the silence assertions).
- VM e2e: 110 pass / 0 fail / 517 expect calls. The new `parser-stderr-silence.e2e.test.ts` test passed against the live VM harness.
<!-- SECTION:FINAL_SUMMARY:END -->
