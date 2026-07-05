---
title: 'principles: transfer modes'
description: What fast / optimised / portable each promise — transfer mode as a metadata and artwork strategy relative to the device's storage, and the default it sets for lossy reduction.
sidebar:
  order: 2
---

Transfer mode answers one question: **how much should podkit optimise the file
itself for this device, given how the device stores metadata and artwork?** It
is the metadata/artwork axis — *not* the bitrate axis (that is
[transcoding](./transcoding.md)). The two are separate concerns that compose.

For the exact per-format behaviour matrix and FFmpeg arguments, see
**doc-011** (PRD: Transfer Mode) and **doc-012** (Spec: Transfer Mode Behavior
Matrix). This doc states the *promise* each mode makes and why.

---

## The principle

A device reads artwork and metadata from one of three places — an internal
**database** (iPod), data **embedded** in the file (most DAPs), or a **sidecar**
file beside it (some Rockbox themes, Echo Mini). What is "dead weight" versus
"essential" depends entirely on that storage model. Transfer mode is the user's
intent about that trade-off, applied **uniformly to every file** and adapted to
what the device actually needs.

It governs **metadata and artwork only**: whether embedded artwork is stripped,
resized, or preserved, and whether a copy is a plain byte copy or routed through
FFmpeg to rewrite tags. It never, by itself, changes a file's **codec or
bitrate**.

## The three promises

| Mode | Promise | On a database-artwork device (iPod) |
|---|---|---|
| **`fast`** | Do the fastest thing. Minimal processing. | Direct byte copy where the codec is playable; strip artwork only on files already being transcoded. |
| **`optimised`** | Cut the file down. Remove metadata/artwork the device does not read from the file. | Strip embedded artwork from copies too (FFmpeg passthrough); on embedded-artwork devices, *resize* rather than strip. |
| **`portable`** | Keep files self-contained and ready to extract — even through a transcode. | Preserve embedded artwork and metadata on every path, including transcoded output. |

Device-awareness is part of the promise: `optimised` *strips* on a device that
reads artwork from its database but *resizes* on a device that reads artwork
from the file, because stripping there would degrade playback. The intent
("cut it down") is constant; the mechanism adapts to the storage model.

## Transfer mode sets the lossy-reduction default

Although transfer mode does not itself reduce bitrate, each mode has a natural
lean that becomes the **default** of the independent lossy-reduction axis
(`[bitrate].reduce = auto`):

| Mode | Reduction default | Why |
|---|---|---|
| `fast` | **preserve** | Re-encoding is slow; copying the original is faster. |
| `optimised` | **convert** | Shrinking an over-cap lossy file is on-brand for "cut it down". |
| `portable` | **preserve** | Fidelity-leaning; but if reduction is *explicitly* chosen, portable still preserves artwork through it. |

This is a **default**, not a gate. An explicit `[bitrate].reduce = always`
or `never` overrides it, so `fast + always` (shrink while syncing fast) and
`optimised + never` (strip artwork but never re-encode) are both reachable.
See [transcoding](./transcoding.md) and
[ADR-023](../../adr/adr-023-lossy-reduction-down-only.md).

## What this principle deliberately does not do

- **It does not decide whether to reduce bitrate.** That is the reduction axis;
  transfer mode only supplies its default.
- **It does not pick codecs.** Codec selection follows the resolved preference
  stack — see [transcoding](./transcoding.md).

## Related

- doc-011 / doc-012 — the behaviour matrix and FFmpeg arguments.
- [ADR-023](../../adr/adr-023-lossy-reduction-down-only.md) — the two-axis model
  and the reduction defaults.
- [transcoding](./transcoding.md) — the axis transfer mode defaults.
- [library-safety](./library-safety.md) §9 — "defaults follow evident intent".
