---
"podkit": patch
"@podkit/core": patch
---

New `podkit doctor` check `sysinfo-modelnum-mismatch` detects when the on-disk classic SysInfo file's `ModelNumStr` disagrees with the firmware-derived identity (e.g. SysInfo manually edited, or files copied from another iPod). Offers `--repair sysinfo-modelnum-mismatch` to overwrite the on-disk file with firmware-derived data. Identified during the TERAPOD (iPod 5G with iFlash mod) inventory pass — the SysInfo claimed `MA147` (5G) while the serial said `V9M`/`A446` (5.5G).
