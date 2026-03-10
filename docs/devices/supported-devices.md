---
title: Supported Devices
description: iPod model compatibility, verification status, and feature support for podkit.
sidebar:
  order: 1
---

# Supported iPod Models

This document lists all iPod models and their compatibility with podkit.

## Overview

podkit uses [libgpod](https://github.com/gtkpod/libgpod) for iPod database management. Our device support directly reflects libgpod's capabilities. libgpod works with iPods that use **USB Mass Storage mode** with the **iTunesDB** database format.

Devices that use iOS sync protocols (iPod Touch, iPhone, iPad) or require iTunes-specific authentication (buttonless Shuffles) are **not supported** by libgpod and therefore not supported by podkit.

## Support Status Legend

| Status | Meaning |
|--------|---------|
| **Full** | All features work: music, artwork, playlists |
| **Music Only** | Music sync works, but no artwork support |
| **Partial** | Some limitations; see notes |
| **Not Supported** | Device cannot be used with podkit |

## Verification Status Legend

| Symbol | Meaning |
|--------|---------|
| :white_check_mark: | Confirmed working with real hardware |
| :test_tube: | Has automated E2E test coverage |
| :grey_question: | Unverified (should work based on libgpod support) |

## iPod Classic / Video Series

These are the best-supported devices, with full music, video, artwork, and playlist support.

| Model | Generation | Support | E2E Test | Real Device | Notes |
|-------|------------|---------|----------|-------------|-------|
| iPod (Original) | 1st | Full | :grey_question: | :grey_question: | Firewire only; may require manual SysInfo |
| iPod | 2nd | Full | :grey_question: | :grey_question: | Firewire/USB |
| iPod | 3rd | Full | :grey_question: | :grey_question: | Dock connector |
| iPod | 4th | Full | :grey_question: | :grey_question: | Click wheel introduced |
| iPod Photo | 4th (Photo) | Full | :grey_question: | :grey_question: | Color screen, artwork support |
| iPod Video 30GB | 5th | Full | :grey_question: | :white_check_mark: | Model numbers: MA002, MA146 |
| iPod Video 60GB | 5th | Full | :grey_question: | :white_check_mark: | Model numbers: MA003, MA147 |
| iPod Video 30GB | 5.5th | Full | :grey_question: | :grey_question: | Model number: MA444, MA446 |
| iPod Video 80GB | 5.5th | Full | :grey_question: | :grey_question: | Model number: MA450, MA448 |
| iPod Classic 80GB | 6th | Full | :grey_question: | :grey_question: | Model numbers: MB029, MB147, MB150 |
| iPod Classic 120GB | 6th | Full | :grey_question: | :grey_question: | Model number: MB565 |
| iPod Classic 160GB | 6th | Full | :grey_question: | :grey_question: | Model number: MB145 (thick) |
| iPod Classic 160GB | 7th | Full | :grey_question: | :grey_question: | Model number: MC293, MC297 (thin) |

## iPod Nano Series

| Model | Generation | Support | E2E Test | Real Device | Notes |
|-------|------------|---------|----------|-------------|-------|
| iPod Nano | 1st | Full | :grey_question: | :grey_question: | Model numbers: MA004, MA005, MA099, MA107, MA350, MA352 |
| iPod Nano | 2nd | Full | :grey_question: | :grey_question: | Multiple colors; model numbers: MA477-MA428 |
| iPod Nano | 3rd | Full | :grey_question: | :grey_question: | "Fat" design, video support; model numbers: MA978-MB261 |
| iPod Nano | 4th | Full | :grey_question: | :grey_question: | Curved design; model numbers: MB598-MB918 |
| iPod Nano | 5th | Full | :grey_question: | :grey_question: | Video camera; model numbers: MC027-MC075 |
| iPod Nano | 6th | **Not Supported** | N/A | N/A | Different database format; touch screen square design |
| iPod Nano | 7th | **Not Supported** | N/A | N/A | Different database format; tall touch screen |

## iPod Mini Series

| Model | Generation | Support | E2E Test | Real Device | Notes |
|-------|------------|---------|----------|-------------|-------|
| iPod Mini 4GB | 1st | Full | :grey_question: | :grey_question: | Model number: M9160 |
| iPod Mini 4GB/6GB | 2nd | Full | :grey_question: | :grey_question: | Model numbers: M9800-M9807 |

## iPod Shuffle Series

| Model | Generation | Support | E2E Test | Real Device | Notes |
|-------|------------|---------|----------|-------------|-------|
| iPod Shuffle 512MB/1GB | 1st | Music Only | :grey_question: | :grey_question: | No screen, no artwork; USB stick form factor |
| iPod Shuffle 1GB/2GB | 2nd | Music Only | :grey_question: | :grey_question: | Clip design; no screen, no artwork |
| iPod Shuffle 2GB/4GB | 3rd | **Not Supported** | N/A | N/A | Buttonless design; requires iTunes authentication hash |
| iPod Shuffle 2GB | 4th | **Not Supported** | N/A | N/A | Buttonless design; requires iTunes authentication hash |

## iOS Devices (Not Supported)

These devices use iOS sync protocols instead of USB Mass Storage + iTunesDB. They **cannot** be supported by libgpod or podkit.

| Device | Reason Not Supported |
|--------|---------------------|
| iPod Touch (all generations) | Uses iOS sync protocol; iTunesDB requires cryptographic signing |
| iPhone (all models) | Uses iOS sync protocol |
| iPad (all models) | Uses iOS sync protocol |

### Why Can't These Be Supported?

Starting with iPod Touch, Apple changed the sync architecture:

1. **No USB Mass Storage**: iOS devices don't mount as a filesystem
2. **Signed Database**: The iTunesDB must be cryptographically signed by iTunes
3. **Proprietary Protocol**: Sync uses Apple's proprietary AFC (Apple File Conduit) protocol

libgpod cannot implement iTunes' signing mechanism, making iOS device support technically impossible without reverse-engineering Apple's authentication.

## Feature Support by Generation

| Generation | Music | Artwork | Video | Playlists | Smart Playlists |
|------------|-------|---------|-------|-----------|-----------------|
| 1st-4th Gen | :white_check_mark: | :white_check_mark:* | :x: | :white_check_mark: | :white_check_mark: |
| Photo | :white_check_mark: | :white_check_mark: | :x: | :white_check_mark: | :white_check_mark: |
| Video (5th/5.5th) | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Classic (6th/7th) | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Mini | :white_check_mark: | :white_check_mark: | :x: | :white_check_mark: | :white_check_mark: |
| Nano 1st-2nd | :white_check_mark: | :white_check_mark: | :x: | :white_check_mark: | :white_check_mark: |
| Nano 3rd-5th | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Shuffle 1st-2nd | :white_check_mark: | :x: | :x: | :white_check_mark: | :x: |

*Early generations may have limited artwork format support.

## iFlash / SD Card Adapters

iPods with [iFlash](https://www.iflash.xyz/) or similar SD card adapters are fully supported. These adapters replace the original hard drive but don't change the iPod's firmware or database format.

**Note**: Large capacity iFlash builds (>128GB) may have mounting issues on macOS. See [macOS Mounting Issues](/troubleshooting/macos-mounting) for troubleshooting.

## Rockbox Compatibility

iPods running [Rockbox](https://www.rockbox.org/) firmware work differently:

- **Database not required**: Rockbox can browse files directly on the filesystem
- **Dual-boot friendly**: Tracks synced via podkit are visible in both firmwares
- **Rockbox database**: Rockbox maintains its own database separate from iTunesDB

If you use Rockbox, you can still use podkit to organize and sync your music. The tracks will be playable through Rockbox's file browser or after building Rockbox's database.

## Confirming Your Device Works

If you have an iPod model marked as :grey_question: and successfully use it with podkit, please help us verify support:

1. **Report success**: Open an issue or PR noting your model number and any observations
2. **Model number**: Found in Settings > About on the iPod, or on the device's back
3. **What to test**:
   - Basic sync (adding tracks)
   - Artwork display
   - Playlist creation
   - Video sync (if applicable)

## Troubleshooting

### "Unknown" Model Detection

If podkit shows your iPod as "Unknown Generation":

1. Check if `iPod_Control/Device/SysInfo` exists on your iPod
2. If missing, create it with your model number:
   ```bash
   echo "ModelNumStr: MA147" > /Volumes/IPOD/iPod_Control/Device/SysInfo
   ```
3. See [iPod Internals](/devices/ipod-internals) for model number reference

### Device Not Mounting

- **macOS**: See [macOS Mounting Issues](/troubleshooting/macos-mounting)
- **Linux**: Ensure you have appropriate udev rules; see libgpod documentation

## See Also

- [iPod Internals](/devices/ipod-internals) - iTunesDB format and device quirks
- [macOS Mounting Issues](/troubleshooting/macos-mounting) - Large iFlash troubleshooting
