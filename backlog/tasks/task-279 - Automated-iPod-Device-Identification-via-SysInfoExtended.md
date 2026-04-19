---
id: TASK-279
title: Automated iPod Device Identification via SysInfoExtended
status: To Do
assignee: []
created_date: '2026-04-19 17:10'
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
- [ ] #1 podkit device add on a freshly restored iPod automatically reads SysInfoExtended from firmware and writes it to iPod_Control/Device/SysInfoExtended
- [ ] #2 podkit doctor detects missing SysInfoExtended and suggests a repair command
- [ ] #3 podkit doctor --repair sysinfo-extended reads and writes SysInfoExtended from the connected device
- [ ] #4 Device is identified by exact model including color and capacity (e.g., iPod nano 8GB Black 3rd Generation)
- [ ] #5 Works on both macOS and Linux
- [ ] #6 USB product ID table covers both 0x120x and 0x126x ranges
- [ ] #7 iPod models requiring hash72/hashAB show clear limitation messages
<!-- AC:END -->
