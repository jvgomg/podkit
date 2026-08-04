---
id: doc-057
title: Dual-libc Linux Distribution Plan (glibc + musl)
type: specification
created_date: '2026-08-04 15:15'
tags:
  - distribution
  - build
  - linux
  - libgpod-node
  - homebrew
  - docker
  - m-23
---
# Dual-libc Linux Distribution Plan (glibc + musl)

Milestone: **m-23**. Decision record: **ADR-026**. Supersedes the current musl-only release, which cannot execute on glibc Homebrew hosts.

## Problem (proven; Opus-verified against repo)

The released Linux binary is **musl-only** — `release.yml → build-platform.yml` has only `build-musl-x64` / `build-musl-arm64` Linux jobs (Alpine container); there is no glibc CLI job in the release path. Homebrew-on-Linux requires **glibc**, and `homebrew-tap/Formula/podkit.rb:20-29` points Linux at the musl tarballs. On a clean Debian host the musl binary **cannot execute** (`interpreter /lib/ld-musl-<arch>.so.1` → `cannot execute: required file not found`); confirmed on `podkit-tests-debian-glibc` against the real v0.6.0 tarball. **Every glibc Homebrew user is broken.** CI didn't catch it — the "binding loads" gate runs only inside Alpine (`build-platform.yml:321,487`); there is no glibc runtime test.

Constraints: `bun build --compile` cannot statically link libc (binary always dynamically links the host libc); a native `.node` shares the host process libc (a musl `.node` can't load in a glibc process → TASK-468). So a single universal binary is impossible with Bun; each libc needs its own build.

## Decision (see ADR-026)

Ship **two** Linux flavors, correct per channel:

| Target | libc | Binary |
|---|---|---|
| Homebrew (Debian/Ubuntu/Fedora), Debian tarball | glibc | **glibc** (`-gnu` tarball) |
| Alpine, Docker (Alpine base) | musl | musl (current bare-name tarball) |

**Invariant:** the only host *dynamic* deps are the system libc + ffmpeg. All native deps (libgpod/glib/gdk-pixbuf/libplist/libxml2/sqlite/png/jpeg/tiff/pcre2/ffi/z/intl) are statically linked into the `.node`, enforced by fail-closed gates + an interpreter assertion. `usb`/`libudev` may degrade gracefully.

## Work (tracer-bullet tasks under m-23)

1. **compile.sh libc-explicit prebuild selection (fixes TASK-468).** `compile.sh:34-40` currently picks the `-musl` prebuild dir *before* glibc ("first dir wins"); a stray host musl prebuild leaks into the glibc builder. Fix: select the gpod prebuild explicitly by host libc (`ldd /bin/sh | grep musl` — the logic already at `compile.sh:75` for the `usb` prebuild). **Do NOT "exclude prebuilds/ from the rsync"** — the `.node` is *delivered* by that rsync (`build-linux-binary.sh:154-158`); excluding it hard-fails `compile.sh:49-55`.
2. **glibc release binary.** Add a new glibc compile+tarball job to `build-platform.yml` (net-new; `prebuild.yml`'s glibc job only builds a `.node` and isn't wired to release tags). Build in a **baseline-glibc container (~2.31 / `ubuntu:20.04`-class)** on `ubuntu-latest` (stock old runners retired), bounded below by Bun's embedded-runtime glibc floor; **verify portability on the oldest supported distro empirically**. Emit `podkit-linux-{x64,arm64}-gnu.tar.gz` (keep musl at the bare names so Docker is untouched). Repoint `Formula/podkit.rb:22,26` + add `SHA_LINUX_{X64,ARM64}_GNU` lookups/awk branches to `update-homebrew-formula.sh:48-78`. (`release.yml:226` globs `podkit-*.tar.gz` → glibc tarballs + SHA256SUMS flow automatically.)
3. **Fail-closed linkage gates + interpreter assertion.** Align every binary/`.node` gate (glibc+musl × x64+arm64) to reject the **full** forbidden lib set (some jobs grep only a subset — `build-platform.yml:317,138`). Add the **interpreter assertion** (glibc→`ld-linux-*`, musl→`ld-musl-*`) on every produced binary + `.node` incl. the new glibc job — the single guard that catches both the ship bug and TASK-468. Add an interpreter gate to `docker.yml` "Prepare binaries" (`:58-69`) so a naming slip can't ship a glibc binary in the Alpine image.
4. **Debian + Alpine smoke suites.** Run the *real* binary: `--version` (executes at all), `device scan --json`, and a **native libgpod read through the addon** — `device info --device <dir>` against a **valid `gpod-testing` template** (real gpod-tool `iTunesDB`, e.g. MA147), asserting **success / known track count** (NOT the pure-TS `packages/ipod-db/fixtures/**`, which never touch the native binding; NOT the current gate's weak "it errored" check at `build-platform.yml:157`); plus the `inquiry-methods` USB path **degrades cleanly without libudev**. Run in CI (Debian container for glibc, Alpine for musl) wired into `build-platform.yml`/`verify-release.yml`, and locally via `podkit-tests-debian-glibc` + `podkit-tests-alpine-musl` (`mise test:linux:debian`/`:alpine`).
5. **Harness alignment.** The Debian harness (`podkit-device-harness`) installs the glibc binary; with task 1 landed it embeds the glibc `.node` — same artifact real users get; closes TASK-468.

## Non-goals / trims
Single universal binary; self-extract; glibc-only/musl-only; static-linking libc into the Bun binary; a **glibc daemon** variant (daemon ships only in Docker/musl — `docker.yml:46-64`, `Formula/podkit.rb:32`); `gpod-tool` dual-libc (test-only C CLI, not distributed).

## Risks
- **Docker regression via naming** — keep musl bare names + the `docker.yml` interpreter gate (highest-risk silent failure).
- **Bun glibc floor (~2.31)** — a baseline build below the floor still won't run; verify on the oldest target.
- **`prebuild.yml` is disconnected from releases** — the glibc capability must live in / be called by `build-platform.yml`.

## Provenance
Diagnosed while investigating VM test failures (the enumeration-race fix, commits `5556e966`/`cd851a53`, surfaced a musl `.node` on the glibc harness → TASK-468 → this distribution-level gap). Plan reviewed by an Opus build-engineering pass; corrections folded in.
