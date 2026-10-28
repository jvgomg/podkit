---
'podkit': patch
---

Re-sign the compiled macOS binary ad hoc when Bun leaves an invalid signature behind, so the CLI no longer exits with status 137 on launch on Apple Silicon.
