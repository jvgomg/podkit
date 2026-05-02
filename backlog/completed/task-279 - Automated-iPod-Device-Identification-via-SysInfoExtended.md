---
id: TASK-279
title: Automated iPod Device Identification via SysInfoExtended
status: Done
assignee: []
created_date: '2026-04-19 17:10'
updated_date: '2026-04-29 12:37'
labels:
  - device
  - libgpod
  - usb
dependencies: []
documentation:
  - >-
    backlog/docs/doc-029 - PRD: Automated iPod Device Identification via
    SysInfoExtended.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent task for automated iPod device identification. Modern iPods (post-2006) don't create a populated SysInfo file after restore, causing libgpod to treat the device as generic — no artwork, no ALAC, broken checksums. This work integrates SysInfoExtended reading (via USB vendor control transfers using libusb) into podkit's device setup flow, eliminating all manual device identification steps.

See PRD: doc-029 for full design, user stories, and implementation decisions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 podkit device add on a freshly restored iPod automatically reads SysInfoExtended from firmware and writes it to iPod_Control/Device/SysInfoExtended
- [x] #2 podkit doctor detects missing SysInfoExtended and suggests a repair command
- [x] #3 podkit doctor --repair sysinfo-extended reads and writes SysInfoExtended from the connected device
- [x] #4 Device is identified by exact model including color and capacity (e.g., iPod nano 8GB Black 3rd Generation)
- [x] #5 Works on both macOS and Linux
- [x] #6 USB product ID table covers both 0x120x and 0x126x ranges
- [x] #7 iPod models requiring hash72/hashAB show clear limitation messages
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary\n\nAutomatic iPod device identification via SysInfoExtended — eliminates all manual device configuration for post-2006 iPods.\n\n### Problem\n\nModern iPods (Classic 6/7G, Nano 3G+) don't create a populated SysInfo file after restore. libgpod treats them as \"generic\" — no artwork, no ALAC support, broken database checksums. Users had to manually run a separate tool or look up model numbers.\n\n### Solution\n\npodkit now automatically reads SysInfoExtended from iPod firmware via USB vendor control transfers during `device add`, writes it to the device filesystem, and uses the rich identity data (serial → exact model with color/capacity/generation) for all downstream operations.\n\n### What shipped\n\n- **Native binding**: `readSysInfoExtendedFromUsb()` via N-API with dlsym runtime resolution\n- **USB discovery**: serial, bus number, device address on both macOS and Linux\n- **Unified model registry**: 0x120x + 0x126x USB ID ranges, 190+ serial suffix→model mappings, checksum type classification\n- **Orchestrator**: read → validate → write pipeline with dependency injection for testing\n- **Readiness pipeline**: SysInfoExtended-aware with checksum severity (hash58+ fail, others warn)\n- **Diagnostic check**: `doctor --repair sysinfo-extended` for manual repair\n- **Device add integration**: automatic, non-blocking, enriches model display\n- **CI prebuild**: libusb statically linked, itdb_usb.c patched into libgpod, force_load for dlsym\n- **Refactoring**: consolidated macOS tree traversal, declarative readiness rules, aligned platform USB info\n\n### Technical decisions\n\n- **dlsym over static linking**: gracefully unavailable on systems without libusb\n- **Regex plist parsing**: simple, sufficient for known key extraction, no XML parser dependency\n- **Model data duplication**: copied from libgpod rather than importing ipod-db (future consolidation tracked)\n- **Non-blocking device add**: USB failures warn but never block — older iPods work without SysInfoExtended"
<!-- SECTION:FINAL_SUMMARY:END -->
