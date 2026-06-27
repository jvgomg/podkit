---
id: TASK-438
title: Remove libusb from libgpod / libgpod-node builds
status: Done
assignee: []
created_date: '2026-06-27 15:16'
labels:
  - build
  - libgpod
dependencies: []
modified_files:
  - tools/prebuild/disable-libgpod-libusb.sh
  - tools/libgpod-macos/build.sh
  - tools/prebuild/build-static-deps.sh
  - .changeset/libgpod-without-libusb.md
ordinal: 200000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
libgpod 0.8.3's `configure` auto-detects `libusb-1.0` via pkg-config (`PKG_CHECK_MODULES(LIBUSB, ...)`) with no opt-out and links it whenever present. The only consumer is `itdb_read_sysinfo_extended_from_usb()`, which has zero callers across podkit — USB SysInfoExtended reads live in `@podkit/ipod-firmware` (via the `usb` npm package). A prior partial cleanup (task-293, commit fbb3b576) removed libusb from the static prebuild + CI and from the libgpod-node binding surface, but the macOS dev build (`tools/libgpod-macos/build.sh`) still detected and linked libusb, so the installed `~/.local/lib/libgpod.4.dylib` and the dev `gpod-tool` pulled `libusb-1.0.0.dylib` transitively. This caused `gpod-tool init` to hang indefinitely on macOS in an uninterruptable IOKit syscall.

This task adds a real `--without-libusb` opt-out to libgpod and passes it in every build podkit controls, then verifies libusb is gone and that the hang is fixed.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed. libusb removed from every libgpod build podkit controls; the macOS `gpod-tool` hang is FIXED.

## Production-build libusb status (verified)
- **linux-arm64 prebuild** (committed `.node`): already libusb-free. `nm` parses, zero libusb symbols; `strings` shows no `libusb-1.0.so` and no `_libusb_*`; only NEEDED shared libs are libc/libgcc_s/libm/libstdc++ (everything else static). (`usbdevice`/`usbfs` are harmless libgpod path string constants.)
- **macOS/Linux CI prebuilds** (built via `build-static-deps.sh`, not committed): were already libusb-free because they build only `src/` (stock libgpod has `itdb_usb.c` in `tools/`, not `src/`), but macOS configure still *detected* libusb via Homebrew pkg-config. Now hardened with `--without-libusb`.

## What changed
- **NEW `tools/prebuild/disable-libgpod-libusb.sh`** — idempotent helper that rewrites libgpod's `configure.ac` to wrap the libusb probe in `AC_ARG_WITH([libusb])` + `AS_IF`, enabling a real `--without-libusb`. Errors loudly if the expected line is missing.
- **`tools/libgpod-macos/build.sh`** (macOS dev build) — calls the helper after patching; passes `--without-libusb` to `./configure`. This is the build that was leaking libusb.
- **`tools/prebuild/build-static-deps.sh`** (CI prebuild, both macOS and Linux libgpod blocks) — calls the helper; passes `--without-libusb`.
- **`.changeset/libgpod-without-libusb.md`** — patch bump for `@podkit/libgpod-node` (build hardening; no API/runtime behaviour change).

## Dead binding surface
Did NOT exist — already removed in task-293.04. `packages/libgpod-node/native/*.cc` + `src/` contain no `readSysInfoExtendedFromUsb`/libusb/dlsym; only filesystem `getSysInfo`/`setSysInfo` DB ops remain. AGENTS.md's "database operations only; no USB/libusb" is accurate; no doc change needed.

## Rebuild + verification (otool/nm before→after)
- `~/.local/lib/libgpod.4.dylib`: BEFORE linked `/opt/homebrew/opt/libusb/lib/libusb-1.0.0.dylib`; AFTER rebuilt with `--without-libusb` → no libusb in `otool -L`.
- `tools/gpod-tool/gpod-tool` (rebuilt): no libusb in `otool -L`; no undefined `_libusb_*` in `nm -u`. (`bin/gpod-tool` is a gitignored turbo artifact; refreshed.)
- `packages/libgpod-node/build/Release/gpod_binding.node` (rebuilt): no libusb in `otool -L`; no undefined libusb symbols.

## LIVE HANG TEST — FIXED
`gpod-tool init <tmp> --json --model MA147 --name "E2E Test iPod"` previously hung forever; now completes immediately with `{"success": true, ...}` and exit 0. **libusb was the actual cause of the macOS hang**, not merely dead weight — the IOKit stall came from the libusb dylib being loaded, even though `libusb_init()` was never explicitly called.

## libgpod-node tests
13/13 integration test files pass, 0 failed (DB ops intact). Their completion (they drive gpod-tool) is additional confirmation the hang is gone.

## Not removed / assumed
- Could not rebuild/verify the non-committed CI prebuilds for other platforms (linux-x64, darwin-*) locally; they are produced by CI from the now-hardened `build-static-deps.sh`. The committed linux-arm64 prebuild and all locally-rebuilt macOS artifacts are verified clean.
- `@podkit/ipod-firmware`'s `usb` npm package / koffi path is the intended USB transport and was left untouched.
<!-- SECTION:FINAL_SUMMARY:END -->
