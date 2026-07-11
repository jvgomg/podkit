---
"@podkit/core": patch
---

doctor: the firmware inquiry-methods check now reports USB transport availability, its failure reason, and the effective transport plan (USB-only / SCSI-only / USB-then-SCSI / none) — not just SCSI. Status is now USB-first: a host with a working USB stack but no `/dev/sg*` nodes (the common container case) no longer shows a spurious warning, and a silently-unloadable USB transport is now surfaced instead of hidden.
