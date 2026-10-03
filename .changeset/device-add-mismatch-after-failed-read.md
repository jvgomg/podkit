---
"podkit": patch
---

`podkit device add` now refuses a device whose on-disk SysInfo disagrees with the connected iPod even when the live `SysInfoExtended` read fails. Previously, a failed read skipped that check, and a mismatched device could be added without the `IDENTITY_MISMATCH` refusal it gets otherwise. A device identified only by its USB identity still adds, with a warning that its model is unknown.
