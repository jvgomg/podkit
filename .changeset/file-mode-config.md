---
"podkit": minor
"@podkit/core": minor
---

Add `fileMode` config option to control embedded artwork in transcoded files. When set to `optimized` (default), artwork is stripped from transcoded files since iPods read artwork from their internal database. When set to `portable`, artwork is preserved for compatibility with other players. Fixes contradicting FFmpeg args where both `-c:v copy` and `-vn` were present.
