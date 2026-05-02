---
"podkit": patch
"@podkit/core": patch
"@podkit/libgpod-node": patch
---

Fix `doctor --repair sysinfo-extended` showing unhelpful "Could not read device identity from USB" with no detail. The native USB binding now throws descriptive errors (e.g. "USB control transfer failed (bus 3, device 4)") instead of returning null silently. Also fix all doctor repair intro messages — they incorrectly said "Repairing X for N tracks" even for non-track operations like SysInfoExtended and orphan cleanup. Intro messages now use each repair's own description.
