---
title: "ADR-026: Dual-libc Linux Distribution (glibc + musl)"
description: Ship a glibc binary to Homebrew/Debian and a musl binary to Alpine/Docker; statically link all of our native dependencies (only the host's system libc + ffmpeg remain dynamic); assert the interpreter and smoke-test the real binary on both distros. Fixes the current musl-only release, which cannot execute on glibc Homebrew hosts.
sidebar:
  order: 27
---

# ADR-026: Dual-libc Linux Distribution (glibc + musl)

## Status

**Accepted** (2026-08-04)

Refines the distribution mechanics of [ADR-021](/developers/adr/adr-021-cli-bun-binary-distribution) (CLI ships as a Bun `--compile` binary).

## Context

The released Linux binary is **musl-only** (`release.yml` → `build-platform.yml`, whose only Linux jobs are `build-musl-x64` / `build-musl-arm64` on an Alpine container). Homebrew-on-Linux **requires glibc** and the tap formula points Linux users at those musl tarballs. On a clean Debian/Ubuntu host the musl binary **cannot execute** — its program interpreter is `/lib/ld-musl-<arch>.so.1`, which does not exist on glibc, so `podkit --version` fails with `cannot execute: required file not found`. Empirically confirmed on `podkit-tests-debian-glibc` against the real v0.6.0 release tarball. **Every glibc Homebrew user is broken.** CI never caught it: the "native binding loads" functional gate runs only inside Alpine containers, and there is no glibc runtime test anywhere.

Two facts constrain the fix:

1. **`bun build --compile` cannot statically link libc.** The produced binary always dynamically links the host libc (glibc or musl, per the build host). A truly-static single binary is not achievable without building Bun from source against a static toolchain — out of scope. So a binary is inherently tied to one libc.
2. **A native `.node` addon shares the host process's libc** — a musl `.node` cannot load into a glibc Bun process (this is the mechanism behind TASK-468). So "one native blob for both libcs" is physically impossible; each libc needs its own build.

Given (1) and (2), a single universal Linux binary is not achievable with Bun; and self-extracting / bundled-loader schemes were considered and rejected for complexity. Dropping either libc was rejected — Homebrew needs glibc, and we will not lose Alpine.

## Decision

Ship **two** Linux flavors and make each correct for its channel:

- **glibc** binary → Homebrew (Debian/Ubuntu/Fedora) + the direct Debian tarball.
- **musl** binary → Alpine + the Docker image (Alpine base).

**Invariant (the principle):** the binary's only host *dynamic* dependencies are the **standard system libc** (glibc or musl, ubiquitous on its target) and **ffmpeg** (external by design). Every native dependency we add — libgpod, glib, gdk-pixbuf, libplist, libxml2, sqlite, png/jpeg/tiff, pcre2, ffi, z, intl — is **statically linked into the `.node`** and this is enforced by fail-closed CI gates. The `usb` addon's `libudev.so.1` dependency is permitted to degrade gracefully (firmware inquiry is optional).

**Enforcement:** an **interpreter assertion** on every produced binary and `.node`, per libc (`ld-linux-*` for glibc jobs, `ld-musl-*` for musl jobs) — the single cheapest guard that catches both the shipping bug and TASK-468 — plus **runtime smoke tests** that execute the real binary on both Debian (glibc) and Alpine (musl) and exercise the native libgpod path.

**Naming:** musl artifacts keep their current bare names (`podkit-linux-{x64,arm64}.tar.gz`) — Docker consumes those; the new glibc artifacts take a `-gnu` suffix. This keeps the Docker path and existing musl steps untouched.

**Baseline:** the glibc binary is built in a baseline-glibc container (glibc ~2.31 / `ubuntu:20.04`-class), bounded below by Bun's own embedded-runtime glibc floor, and its portability is verified on the oldest supported distro rather than assumed.

## Consequences

### Positive
- Homebrew/Debian users get a binary that runs; Alpine/Docker unchanged.
- The static-linking invariant is guaranteed, not assumed, across both libcs and both arches.
- TASK-468 (musl `.node` embedded in the glibc binary) is closed by libc-explicit prebuild selection + the interpreter guard.
- The harness runs the same artifact real Debian users get.

### Negative / costs
- Two Linux build paths and two release artifacts per arch are maintained (inherent to Bun + native addons; not removable).
- The glibc release binary is net-new CI work (a compile+tarball job in `build-platform.yml`, baseline-glibc container).

### Non-goals
Single universal binary; self-extracting binary; glibc-only or musl-only; static-linking libc into the Bun binary; a glibc **daemon** variant (the daemon ships only in Docker/musl).

## Related decisions
- [ADR-021](/developers/adr/adr-021-cli-bun-binary-distribution) — CLI distributes as a Bun `--compile` binary.
- [ADR-002](/developers/adr/adr-002-libgpod-binding) — in-process N-API bindings (the reason a native blob is per-libc).

## References
- Backlog doc: dual-libc Linux distribution plan (m-23).
- TASK-468 — prebuild cross-contamination (folds into this milestone).
