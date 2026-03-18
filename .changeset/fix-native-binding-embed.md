---
"podkit": patch
---

Fix native libgpod binding not loading in compiled CLI binary. The `.node` addon is now embedded directly in the single-file binary using Bun's static require detection, so Homebrew and standalone installs work without a sidecar file.
