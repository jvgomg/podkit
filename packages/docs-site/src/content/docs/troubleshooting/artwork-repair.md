---
title: Artwork Repair
description: How to diagnose and repair corrupted album artwork on your iPod.
sidebar:
  order: 3
---

If your iPod is showing wrong artwork, artwork from a different album, or glitched images, the artwork database may be corrupted.

## Symptoms

- Tracks display artwork from a different album
- Artwork appears corrupted or glitched
- Artwork changes after rebooting the iPod
- Some tracks show correct artwork while most show wrong artwork

## Diagnosis and Repair

Run `podkit doctor` to check your iPod's health. If artwork corruption is detected, you have two repair options:

- **Quick fix** — `podkit doctor --repair artwork-reset` clears all artwork (no source collection needed)
- **Full rebuild** — `podkit doctor --repair artwork-rebuild -c <collection>` rebuilds artwork from your source files immediately

See [iPod Health Checks](/user-guide/devices/doctor#repairing-artwork-corruption) for the full walkthrough, including what each repair does, how to preview with `--dry-run`, and how to choose between them.

## Why This Happens

See [Artwork Corruption Background](/devices/artwork-corruption) for the technical details on what causes this issue.
