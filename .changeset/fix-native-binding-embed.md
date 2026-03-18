---
"podkit": patch
---

Fix native libgpod binding not loading in compiled CLI binary. The Homebrew and standalone binary distributions were completely broken for any command that touched the iPod database. The `.node` addon is now embedded directly in the single-file binary, and all native dependencies are fully statically linked — including on Linux, where builds now use musl/Alpine for universal compatibility across all distros (Debian, Ubuntu, RHEL, Fedora, Arch, Alpine, etc.).
