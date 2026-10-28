---
title: 'ADR-030: Link an Open HashAB Signer Into libgpod'
description: Build libgpod with the Unlicense dstaley/hashab C sources instead of loading an external hashab blob, so the iPod nano 6th/7th generation databases can be signed. Signing alone does not make those generations syncable; they stay read-only.
sidebar:
  order: 31
---

# ADR-030: Link an Open HashAB Signer Into libgpod

## Status

**Proposed** (2026-10-27)

## Context

The iPod nano 6th and 7th generation (SysInfoExtended `DBVersion` 5) sign
`iTunesCDB` and `iTunes Library.itlp/Locations.itdb.cbk` with HashAB.
libgpod 0.8.3 already writes both files, including the SQLite databases and
the artwork, but `itdb_hashAB.c` computes the signature only through a
`hashab` module loaded from `LIBGPOD_BLOB_DIR`, and fails the write without
it. podkit ships no such module.

[dstaley/hashab](https://github.com/dstaley/hashab) is an Unlicense C
implementation of the same `calcHashAB(target, sha1, uuid, rnd)` function,
with 100 reference vectors. It takes the eight-byte FireWire GUID of a nano,
not an iOS device identifier.

## Decision

- Vendor the signer unmodified in `tools/prebuild/vendor/hashab` at a pinned
  commit, with its licence and provenance.
- `tools/prebuild/prepare-libgpod-nano.sh` applies
  `tools/prebuild/libgpod-nano.patch` and copies the sources into
  `src/nano_hashab/` before `autoreconf`, in both the macOS developer build
  and the static prebuild dependencies. The patch replaces the module loader
  with a direct call and builds the sources as an internal convenience
  library, with `-fwrapv` as upstream does, and with their global symbols
  renamed and hidden so that they neither clash with nor leak from libgpod.
- Before signing, the patch requires a 16-digit hexadecimal `FireWireGUID`
  (an optional `0x` prefix is accepted) and otherwise fails the write with an
  error. libgpod's CDB normalisation, SQLite generation and artwork writing
  are unchanged.
- The static dependency cache records a fingerprint of the patch and the
  vendored sources, and the CI cache keys hash all of `tools/prebuild/`, so a
  change to either rebuilds libgpod.
- No runtime dependency, subprocess or N-API surface is added. Python is used
  only by the developer checks in `tools/nano7/`.

## Verification

- The 100 upstream vectors and a third-party reference
  `Locations.itdb`/`.cbk` pair reproduce byte for byte.
- `tools/nano7/test-libgpod.sh`, run in the prebuild workflow, lets the
  patched libgpod create, reparse, resave and delete a synthetic track for a
  nano 7th generation (from the repository's USB SysInfoExtended capture) and
  a nano 6th generation (synthetic capabilities), and checks SQLite integrity
  and both signatures. Malformed and iOS-sized GUIDs fail; a 5th generation
  iPod still gets an unsigned `iTunesDB`.
- On a nano 7th generation (firmware 1.0.4), Apple-written `iTunesCDB` and
  `Locations.itdb.cbk` verify with libgpod's normalisation (hashing scheme 3)
  and the device GUID.

## Consequences

Signing is necessary but not sufficient. On a nano 7th generation (firmware
1.0.4), a library written by this libgpod has valid signatures, yet the
firmware shows no music. `nano_6g` and `nano_7g` therefore keep
`support.access = 'read-only'`; the nano 6th generation's writes are covered
only by synthetic tests. Enabling sync for either generation needs a complete
library write that is verified on the device.
