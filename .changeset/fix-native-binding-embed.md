---
"podkit": patch
---

Fix native libgpod binding not loading in compiled CLI binary. The `.node` addon is now embedded directly in the single-file binary using Bun's static require detection. All native dependencies are fully statically linked on every platform, producing a true zero-dependency single-file binary.
