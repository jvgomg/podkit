# podkit

A toolkit for syncing music collections to iPod devices. This glossary records
the terms podkit uses for concepts that are specific to it — not general
programming vocabulary.

## Language

### Native dependencies

podkit depends on C libraries and build tools that behave very differently
depending on *who* needs them and *when*. The distinguishing test is: **does
this dependency disappear once a prebuilt artifact is present?**

**Runtime dependency**:
A dependency podkit shells out to while running, on an end user's machine as
much as a contributor's. FFmpeg is the only one. No prebuilt artifact removes
it.
_Avoid_: system dependency, external dependency

**Prebuild library**:
A C library linked into a native artifact at compile time, statically, so it is
absent from the shipped result. libgpod, GLib, libplist and gdk-pixbuf are the
set. Needed only by whoever compiles the artifact.
_Avoid_: native dependency, dev dependency

**Prebuild tool**:
A build-time executable used to *produce* a native artifact, never linked into
it. pkg-config is the canonical one; cmake, meson, ninja, autoconf, automake and
libtool join it on the from-source path. Distinguished from a prebuild library
by linking nothing.
_Avoid_: build dependency, toolchain

**Prebuild**:
A compiled, platform-specific native artifact shipped in place of compiling from
source — the `.node` addon for `@podkit/libgpod-node`, or the `gpod-tool` binary.
Its presence is what makes prebuild libraries and prebuild tools unnecessary.
_Avoid_: prebuilt binary, binary artifact

**Dev toolchain**:
The language runtimes and JS tooling a contributor needs regardless of native
code — Bun, Node, TypeScript. Distinct from prebuild tools in that no artifact
ever makes them unnecessary.
_Avoid_: dev dependencies
