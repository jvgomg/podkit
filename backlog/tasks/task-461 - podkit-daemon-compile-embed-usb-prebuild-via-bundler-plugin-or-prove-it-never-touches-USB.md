---
id: TASK-461
title: >-
  podkit-daemon compile: embed usb prebuild via bundler plugin (or prove it
  never touches USB)
status: Done
assignee: []
created_date: '2026-07-11 08:59'
updated_date: '2026-07-11 11:23'
labels:
  - daemon
  - ipod-firmware
dependencies: []
references:
  - packages/podkit-daemon/package.json
  - packages/podkit-cli/scripts/compile-build.ts
  - packages/ipod-firmware/bundler-plugin.cjs
modified_files:
  - packages/podkit-daemon/src/bundle.test.ts
priority: medium
ordinal: 221000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`packages/podkit-daemon` compiles with a plain `bun build src/main.ts --compile` (no staging, no plugin), and its dist bundle inlines `node-gyp-build`, meaning the usb package graph is bundled with the broken runtime resolution the CLI just moved away from (build-machine node_modules path baked in). The daemon's detection path uses lsblk rather than libusb, so this may be latent — but if any code path reaches firmware inquiry (directly or via @podkit/core), it fails on machines without the build tree.

Either (a) adopt the CLI recipe: stage the platform prebuild + drive the compile through a Bun.build script with `usbNativeBundlerPlugin` from @podkit/ipod-firmware/bundler-plugin (see packages/podkit-cli/scripts/compile-build.ts), or (b) demonstrate the daemon bundle cannot reach loadUsb and add a bundle content-check test pinning usb/node-gyp-build out of the graph.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Reachability determined: daemon source never calls loadUsb / firmware inquiry — all device I/O is delegated to the podkit CLI subprocess (verified by reading every daemon src file)
- [x] #2 Decision recorded: option (b) — loadUsb is provably unreachable dead code; do NOT add usbNativeBundlerPlugin to the daemon compile
- [x] #3 Source-level reachability guard test added (packages/podkit-daemon/src/bundle.test.ts) pinning no @podkit/ipod-firmware import, no firmware-inquiry symbols, and the narrow stripPartitionSuffix-only core import
- [x] #4 Compiled daemon binary verified to build and run (start/poll/graceful SIGTERM); the inlined usb/node-gyp-build graph never fires
- [x] #5 The four existing bundle.test.ts files (cli, ipod-firmware, core, devices-ipod) confirmed NOT broken — typecheck clean, 21/21 pass
- [x] #6 Daemon quality gate green: typecheck + build + compile + 113 unit tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DECISION: Option (b) — loadUsb is provably unreachable; no bundler plugin added.

REACHABILITY EVIDENCE:
- Daemon delegates ALL device I/O to the `podkit` CLI subprocess (cli-runner.ts: `podkit --json mount|sync|eject|device list`) and detects devices via lsblk + sysfs (device-poller.ts). No daemon source references firmware/inquiry/loadUsb/usb — grep across src/ returns NONE.
- The ONLY in-process @podkit/core import is the pure string helper `stripPartitionSuffix` (device-poller.ts).
- The usb/koffi/firmware graph IS inlined into the compiled binary (node-gyp-build, SysInfoExtended, loadUsb all present) but is DEAD CODE — it enters the bundle solely because @podkit/core's dist/index.js *statically* imports `@podkit/ipod-firmware`.

WHY THE PLUGIN IS UNNECESSARY (and why option (a) is wrong here):
- The plugin fixes usb's `require('node-gyp-build')(__dirname)` native loader for single-file binaries. That path is reached only when loadUsb() runs. The daemon never runs it, so the latent bug never triggers. Verified: compiled binary starts, polls, and shuts down gracefully on SIGTERM with no node-gyp-build failure.

WHY "PIN USB OUT OF THE BUNDLE" IS NOT ACHIEVABLE (guard is source-level instead):
- Externalizing (`--external @podkit/ipod-firmware`) CRASHES the standalone binary at startup: "Cannot find module '@podkit/ipod-firmware' from '/$bunfs/root/podkit-daemon'" — because core's barrel imports it STATICALLY, and the binary has no node_modules to resolve it. So the graph must stay inlined; a bundle content-scan can't distinguish dead from live code.
- Therefore the guard is a SOURCE-level reachability test (packages/podkit-daemon/src/bundle.test.ts): fails loudly if any daemon source imports @podkit/ipod-firmware, references firmware-inquiry symbols (loadUsb/readUsbInquiry/inquireFirmware/inquireFirmwareDetailed/probeInquiryMethods), or widens the core import beyond stripPartitionSuffix. If a future refactor adds a live edge into loadUsb, the test fails — the signal that the daemon then needs the usbNativeBundlerPlugin (or must keep shelling out).

FOUR bundle.test.ts FILES (cli/ipod-firmware/core/devices-ipod): NOT broken/orphaned. They typecheck clean (tsc --noEmit passes) and all 21 tests pass. The task premise ("Invalid character" syntax errors) is NOT reproducible on the current tree — likely an editor artifact from Unicode typographic apostrophes ('/") in test names/comments, which some parsers flag but tsc and Bun handle fine. Left as-is.

CHANGESET: none needed — this is test-only build-infra with zero behavior change to the shipped daemon binary (compile/build scripts unchanged; binary bytes identical).

Code-complete + green (113 daemon tests incl 3 new guard tests; compile produces a working binary). Awaiting user commit before Done. Decision (b): loadUsb proven unreachable; source-level guard test added instead of the plugin. The four other bundle.test.ts files were investigated and are NOT broken (Unicode-apostrophe editor artifact; tsc + 21 tests pass) — left unchanged. No changeset needed (test-only, zero behaviour change).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Investigated whether the compiled `@podkit/daemon` binary reaches `loadUsb`. Verdict: option (b) — it does NOT. The daemon delegates all device I/O to the `podkit` CLI subprocess and detects devices via lsblk + sysfs; its only in-process `@podkit/core` import is the pure `stripPartitionSuffix` helper. The usb/koffi/firmware graph is inlined into the binary (via core's static import of `@podkit/ipod-firmware`) but is dead code — verified the compiled binary starts, polls, and shuts down gracefully without ever firing the `node-gyp-build` loader. No `usbNativeBundlerPlugin` added.

Added a source-level reachability guard (`packages/podkit-daemon/src/bundle.test.ts`, 3 tests) that fails loudly if a future refactor makes the daemon import firmware / call `loadUsb` in-process — the signal that it would then need the bundler plugin. A bundle-content "pin usb out" test is not viable because externalizing `@podkit/ipod-firmware` crashes the standalone binary at startup (static import, no node_modules to resolve).

The four existing `bundle.test.ts` files (cli/ipod-firmware/core/devices-ipod) are NOT broken — they typecheck clean and all 21 tests pass; the reported "Invalid character" errors were not reproducible (Unicode-apostrophe editor artifact). Left unchanged.

No changeset needed: test-only, zero behavior change (daemon compile/build scripts untouched). Quality gates green: daemon typecheck + build + compile + 113 unit tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
