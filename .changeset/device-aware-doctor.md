---
'@podkit/core': minor
'podkit': minor
---

Add device-aware diagnostics framework to `podkit doctor`. The doctor command now handles mass-storage devices gracefully instead of crashing when pointed at a non-iPod device. Diagnostic checks declare which device types they apply to, and the runner filters them automatically. JSON output now includes a `deviceType` field.
