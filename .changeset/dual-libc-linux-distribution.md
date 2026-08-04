---
"podkit": minor
---

Ship a glibc Linux binary for Homebrew/Debian alongside the existing musl binary (dual-libc distribution).

The released Linux binary was previously musl-only, so its program interpreter was `/lib/ld-musl-*.so.1` — which does not exist on a stock glibc host. Every Homebrew-on-Linux (Debian/Ubuntu/Fedora) user therefore got a binary that could not execute (`podkit --version` → `cannot execute: required file not found`). Homebrew and the direct Debian tarball now install a **glibc** binary (`podkit-linux-{x64,arm64}-gnu.tar.gz`, built against a baseline glibc 2.31), while Alpine and the Docker image continue to use the musl binary. Each native dependency (libgpod, glib, gdk-pixbuf, libplist, libxml2, sqlite, …) is statically linked into the addon and this is enforced by fail-closed CI linkage + program-interpreter gates, plus a runtime smoke that reads a real iTunes database through the native libgpod path on both libcs.
