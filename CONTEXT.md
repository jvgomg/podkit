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

### Test environments

Vocabulary for the machinery that runs podkit's device tests. These terms are
scoped to the testing context; several of the obvious words are already taken by
the product and are deliberately avoided below.

**Substrate**:
The Linux environment the device harness drives — a Lima VM on macOS, a Proxmox
VM on Linux. Named by what it provides (a kernel with `dummy_hcd`, configfs and
a systemd userland), never by which hypervisor produced it.
_Avoid_: "the VM", "test VM" — the repo has seven VMs serving four unrelated
purposes, so the bare noun identifies nothing.

**Provisioner**:
Whatever creates and lifecycles a substrate. Lima is one; Proxmox plus cloud-init
is another. A provisioner's entire output is an SSH-reachable Debian box; it has
no role once the substrate exists.
_Avoid_: treating Lima as the substrate itself — that conflation is what tied the
harness to macOS.

**Substrate link**:
How commands and files reach a substrate — `exec`, `copyIn`, `spawn`. The
`SubstrateLink` interface, implemented over `limactl` and over SSH.
_Avoid_: **transport**. In podkit that word already means how the product reaches
an iPod's firmware (USB vs SCSI — see `@podkit/ipod-firmware`), and both meanings
would otherwise appear in the same test files.

**Harness**:
The device-testing machinery that synthesises USB gadgets *inside* a substrate —
personas, backing files, the FunctionFS daemon, `apply-state.sh`. Distinct from
the substrate it runs on.

**Known overload — "runner"**:
`SubprocessRunner` is a *product* type (`@podkit/device-types`) injected into the
testing layer, while `registerRunner` and `TestRuntime` are testing concepts. Both
meanings coexist and are not being renamed; do not add further "runner" names to
the testing layer.
