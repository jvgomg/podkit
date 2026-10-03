---
"podkit": patch
---

`podkit device add --json` no longer hides a failed live identity read. It still reports `"verification": "verified"`, which names the tier that ran. Two new fields report what actually happened:

- `sysInfoExtended` says whether `SysInfoExtended` was `present`, `written`, `failed`, or `unavailable`.
- `warnings` lists each warning the add raised, including why a USB read failed. In JSON mode these were previously dropped.

The warning shown after a failed read no longer claims the device has "no SysInfoExtended or classic SysInfo" when its model was in fact identified.
