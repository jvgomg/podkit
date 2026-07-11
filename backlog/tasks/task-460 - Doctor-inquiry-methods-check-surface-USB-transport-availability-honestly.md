---
id: TASK-460
title: 'Doctor inquiry-methods check: surface USB transport availability honestly'
status: To Do
assignee: []
created_date: '2026-07-11 08:59'
labels:
  - diagnostics
  - ipod-firmware
dependencies: []
references:
  - packages/podkit-core/src/diagnostics/checks/inquiry-methods.ts
  - packages/ipod-firmware/src/inquiry/probe.ts
priority: medium
ordinal: 220000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `inquiry-methods` doctor check reports SCSI availability only, on the assumption that "the USB transport is always available in shipped binaries (the usb prebuild is embedded)". The Alpine-container verification spike falsified this twice: the runtime bundling interception silently failed on machines without the build tree (fixed via the build-time bundler plugin), and the `usb` prebuild dynamic-links libudev.so.1 which can be absent (Alpine without eudev-libs). In both cases doctor showed a passing/warn check with no hint the USB transport was dead, and `-v`/`-vv` on `device add` surfaced nothing about the skipped transport.

Make USB load failures visible: include usb availability + failure reason in the check details (probe already returns it), consider status derivation when USB is unavailable, and surface the per-transport plan (`usb-then-scsi`/`scsi-only`/`none`) somewhere diagnosable. The stashed `globalThis.__podkit_native_binding_error`-style error for the usb wire was also never consumed anywhere — either surface it or remove the stash.
<!-- SECTION:DESCRIPTION:END -->
