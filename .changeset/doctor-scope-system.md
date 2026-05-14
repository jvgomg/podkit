---
"podkit": minor
---

Add `podkit doctor --scope <system|device|all>` for running host-environment checks without a registered device.

`--scope system` skips device resolution entirely and runs only the system-scope checks (FFmpeg, codec encoders, video encoder, libgpod runtime, SCSI inquiry, udev rule on Linux). Useful before plugging an iPod in for the first time, and required by the m-19 Tier-3 test harness to assert host-state against a captured `SystemState` fixture.

`--scope device` requires `-d/--device` and runs only device-scope checks. `--scope all` (default) preserves the existing combined output byte-for-byte; the legacy `--no-system` flag still applies in that mode. JSON output under `--scope system` uses a discriminator field (`scope: "system"`) so consumers can distinguish the two envelopes.
