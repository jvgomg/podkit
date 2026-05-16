---
"podkit": minor
"@podkit/core": minor
---

Reconcile USB-inquiry and block-device discovery so each connected iPod renders once in `podkit device scan`. Previously, `device scan` could surface the same physical iPod twice on Linux when both pipelines independently identified it. The orphan entry also surfaced a destructive remediation (`Needs partitioning — see: podkit device init`) on a healthy device. Both issues fixed: a new reconciliation primitive matches USB and block-device records by serial number (or disk identifier as fallback), and the readiness-failure copy now points at docs instead of suggesting an inappropriate command.
