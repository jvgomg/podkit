---
id: DRAFT-023
title: >-
  device add --json reports verification "verified" after the live USB inquiry
  failed
status: Draft
assignee: []
created_date: '2026-09-30 21:16'
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
