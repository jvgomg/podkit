---
id: TASK-538
title: >-
  device add --json reports verification "verified" after the live USB inquiry
  failed
status: Done
assignee: []
created_date: '2026-09-30 21:16'
updated_date: '2026-10-03 19:48'
labels:
  - cli
dependencies: []
references:
  - packages/podkit-cli/src/commands/device/add.ts
  - packages/podkit-cli/src/commands/device/verification-policy.ts
priority: low
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen while diagnosing the remote docker-dist failure. The setup was the shipped image on the amd64 remote substrate, running `device add -d X --path /ipod --yes` against a 5G Video persona with a classic SysInfo and SysInfoExtended wiped.

Human output:
- `Warning: Failed to read SysInfoExtended from USB: … LIBUSB_TRANSFER_STALL`
- `Warning: Unable to determine device model from disk — no SysInfoExtended or classic SysInfo. Proceeding with USB identity only`
- The classic SysInfo was present, though only 19 bytes.

The `--json` run of the same flow returned `success: true, verification: "verified"`.

This is Draft because the premise is uncertain: "verified" may legitimately mean the USB descriptor cross-check matched even when the SIE page read failed. If so, the JSON should probably still show that the SIE write was skipped. The misleading "no … classic SysInfo" message when a classic SysInfo exists should be checked too.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The premise held: `verification` names the tier that ran, not its result, and the verify tier's disk-vs-USB cross-check can pass even when the live read fails. So `verification` keeps its documented meaning, and `device add --json` now also reports what happened:

- `sysInfoExtended` is `present`, `written`, `failed` or `unavailable`.
- `warnings` lists every warning the add raised. `OutputContext.warn()` now records warnings in every mode; they used to be dropped under `--json`.

The misleading "no SysInfoExtended or classic SysInfo" warning came from the outcome loop's re-entry guard, which fired `partial-identity` unconditionally after a failed read. It now fires only when no model resolved, and the text is accurate: "Unable to determine the device model from its SysInfo or USB identity."

The docker-dist image cell now asserts `sysInfoExtended === 'written'` and dumps the warnings plus the persona journal when that fails.

A related gap is filed as TASK-537: after a failed read, the cross-check mismatch step is skipped. That predates this fix.
<!-- SECTION:FINAL_SUMMARY:END -->
