---
id: TASK-461
title: >-
  podkit-daemon compile: embed usb prebuild via bundler plugin (or prove it
  never touches USB)
status: To Do
assignee: []
created_date: '2026-07-11 08:59'
labels:
  - daemon
  - ipod-firmware
dependencies: []
references:
  - packages/podkit-daemon/package.json
  - packages/podkit-cli/scripts/compile-build.ts
  - packages/ipod-firmware/bundler-plugin.cjs
priority: medium
ordinal: 221000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`packages/podkit-daemon` compiles with a plain `bun build src/main.ts --compile` (no staging, no plugin), and its dist bundle inlines `node-gyp-build`, meaning the usb package graph is bundled with the broken runtime resolution the CLI just moved away from (build-machine node_modules path baked in). The daemon's detection path uses lsblk rather than libusb, so this may be latent — but if any code path reaches firmware inquiry (directly or via @podkit/core), it fails on machines without the build tree.

Either (a) adopt the CLI recipe: stage the platform prebuild + drive the compile through a Bun.build script with `usbNativeBundlerPlugin` from @podkit/ipod-firmware/bundler-plugin (see packages/podkit-cli/scripts/compile-build.ts), or (b) demonstrate the daemon bundle cannot reach loadUsb and add a bundle content-check test pinning usb/node-gyp-build out of the graph.
<!-- SECTION:DESCRIPTION:END -->
