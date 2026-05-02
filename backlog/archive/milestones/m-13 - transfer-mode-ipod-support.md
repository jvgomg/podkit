---
id: m-13
title: "Transfer Mode: iPod Support"
---

## Description

Implement the three-tier transferMode system (fast/optimized/portable) for iPod devices. Replaces fileMode with a broader config that controls how files are prepared for the device — covering transcodes, ALAC copies, and direct-copy formats (MP3, M4A). Includes DeviceCapabilities abstraction, new operation types, sync tags for all tracks, and --force-transfer-mode flag. See PRD (DOC-011) and specs (DOC-012, DOC-013, DOC-014).
