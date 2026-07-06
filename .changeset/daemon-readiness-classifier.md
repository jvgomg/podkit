---
"@podkit/daemon": patch
---

Daemon gives actionable guidance for devices that need setup instead of a generic "Sync Error"

When `podkit sync` refuses a device (for example an unidentified iPod that needs its one-time USB setup, or an unsupported model), the daemon now classifies the outcome and sends a clear, actionable notification — "Device Needs Setup" with the exact `podkit device add` / `doctor --repair sysinfo-extended` steps — and skips the device without mutating it, rather than reporting a generic sync failure. Clean skips are no longer logged as "completed with errors".
