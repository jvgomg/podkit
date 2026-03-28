---
"podkit": minor
---

Enhanced device commands with readiness diagnostics

- `device scan`: verbose readiness output with per-stage checks, USB discovery for unpartitioned devices, config relationship display, `--mount` flag for automatic mounting, `--report` flag for diagnostic reports
- `podkit doctor`: two-phase diagnostics — readiness checks before database health, graceful handling of devices without databases
- `device info`: readiness summary line in output
- `device init`: readiness-aware guidance with stub messages for format/partition operations
- OS error codes (errno 71, 13, 19, 5) translated to plain-language explanations
