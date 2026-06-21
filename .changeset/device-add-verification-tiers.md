---
"podkit": minor
---

`device add` gains explicit verification tiers, and the `--no-firmware-inquiry` flag is renamed.

**Breaking (CLI):** `--no-firmware-inquiry` is renamed to `--no-verify`. The new flag absorbs its old "skip the SysInfoExtended write" behaviour as a subset and additionally skips the live device cross-check, trusting valid on-disk SysInfo (the "trust-disk" tier — for Docker/headless hosts where SCSI is unavailable but the device is validly mounted). Update any scripts passing `--no-firmware-inquiry`.

**New flag:** `--no-validate` adds a "config-inject" tier that writes the device config purely from your arguments without reading the device at all (zero device I/O). It requires a complete identity — a `--volume-uuid` (or `--path`) plus `--type`. Use it for offline provisioning, CI, and e2e setup. `--no-validate` structurally implies `--no-verify`.

**Verify by default:** With no flags, `device add` now runs the full verify tier — it cross-checks the connected device against its on-disk SysInfo using the existing `sysinfo-consistency` / `sysinfo-modelnum-mismatch` diagnostics and refuses on a mismatch, pointing you at `podkit doctor --repair sysinfo-modelnum-mismatch`. Adding a device is your first chance to confirm it is configured correctly, so the default is cautious; the skip-tiers are explicit opt-outs.

**Behaviour change:** the empty-identity gate is now bypassed only by `--force` (previously `--no-firmware-inquiry` also bypassed it).

**JSON:** the `device add --format json` success envelope gains a `verification` field (`verified` | `trusted-disk` | `config-only`) reporting which tier ran.

New `--volume-uuid` / `--volume-name` identity inputs are also accepted, and `--no-verify` / `--no-validate` appear in shell completions.
