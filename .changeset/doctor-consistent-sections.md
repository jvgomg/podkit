---
"podkit": minor
"@podkit/core": minor
---

`podkit doctor` now renders a consistent `System` / `Device Readiness` / `Database Health` section structure across all device types. Previously, mass-storage devices (Echo Mini) collapsed everything into a single `Device Health` bucket and mis-categorised three system-scope checks. The fix audits every check's `scope` tag, adds a `category?: 'readiness' | 'database'` discriminator so device-scope checks can be routed to the right subsection, and skips `iPod Firmware Inquiry Methods` on non-iPod devices.
