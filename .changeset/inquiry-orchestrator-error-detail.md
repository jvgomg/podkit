---
"podkit": patch
"@podkit/ipod-firmware": patch
---

Improve the firmware-inquiry orchestrator's failure message so users can see what went wrong without `-vv`. The default error now names every transport attempted (USB, SCSI) with each one's failure reason on its own line and includes a remediation hint (e.g. `podkit doctor --repair udev-rule` for EACCES on `/dev/sg*` or `/dev/bus/usb/...`). The orchestrator also no longer short-circuits a planned SCSI fallback when USB hits a permission wall — both transports run if the plan calls for it.
