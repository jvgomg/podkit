---
"podkit": patch
---

Move spinners and progress bars to stderr and auto-suppress when stdout is not a TTY. Adds `--no-tty` flag for explicit suppression. Piped output (e.g. `podkit collection music --format json | jq .`) now produces clean stdout without needing `--quiet`.
