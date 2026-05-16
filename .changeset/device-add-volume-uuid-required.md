---
"podkit": patch
---

`podkit device add` now refuses cleanly when an iPod's volume UUID can't be read, with a clear message + structured error code (`VOLUME_UUID_REQUIRED`). Previously a synthetic `manual-...` UUID could be persisted in config, which then broke replug detection and `podkit doctor -d <name>` lookups. Most-common cause (HFS+ on Linux) was already addressed in TASK-317.12; this is the defensive catch-all for any remaining edge cases (corrupt partition tables, unusual layouts).
