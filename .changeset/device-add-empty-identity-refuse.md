---
"podkit": minor
---

**Behavioural change:** `podkit device add` now refuses to persist a device when the identity cascade resolves nothing at all — no SysInfoExtended path, no classic SysInfo on disk, and no USB fingerprint. Previously such devices were silently persisted with empty identity, which stranded subsequent commands (`podkit doctor -d <name>`, `podkit sync -d <name>`) that rely on identity to track the device across replug cycles.

The refusal exits with code `1`, prints an actionable error (`EMPTY_IDENTITY`), and points to three remediation paths:

- Re-mount the device read-write and check the USB connection, then retry
- Pass `--no-firmware-inquiry` if you knowingly want to skip the firmware inquiry step
- Pass the new `--force` flag to add the device anyway with a warning

Partial-cascade scenarios (SysInfoExtended present but USB fingerprint unresolved, or similar) continue to proceed silently — the warning is reserved for cases where neither SysInfoExtended nor classic SysInfo can be read, which is the genuinely actionable signal.
