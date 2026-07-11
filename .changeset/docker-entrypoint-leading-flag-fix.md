---
"@podkit/docker": patch
---

Fix Docker entrypoint so a leading flag (e.g. `podkit --version`) routes to the CLI instead of failing with `exec: --: invalid option`

`docker run <image> --version` (and `--help`, `-h`, or any leading flag) previously fell through to the raw-command fallback and then errored because `exec` parsed the flag as its own option. A leading-dash argument is now detected before the raw fallback and routed to `podkit` via `su-exec` — identical to how other subcommands are dispatched.
