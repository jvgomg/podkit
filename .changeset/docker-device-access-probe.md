---
"@podkit/docker": minor
"podkit": patch
---

Container startup reports its device access with actionable guidance

Every container start now prints a `Device access:` report: whether an iPod volume is mounted at `/ipod` (path-based sync), whether `/dev/bus/usb` is present (one-time `device add` USB setup), and whether `/dev/sg*` nodes exist — each missing item with guidance on what to do about it, and the path-baseline case clearly distinguished from the USB-setup case. The report is informational and never blocks startup; a path-only setup legitimately has no USB. The logic lives in a new internal CLI helper (`podkit __container-probe`) so it is unit-tested rather than baked into bash.
