---
"podkit": patch
---

The musl (Alpine and Docker) build of `podkit` could occasionally embed the glibc build of its iPod database library. Every sync on such a build then failed with `Error relocating … fcntl64: symbol not found`. The build now detects its C library reliably and refuses to produce a binary whose embedded library was built for the other one.
