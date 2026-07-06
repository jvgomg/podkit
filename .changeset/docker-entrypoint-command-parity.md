---
"@podkit/docker": patch
---

Docker entrypoint: recognise every podkit command and honour combined-form flags

`docker run podkit doctor` (and any other subcommand) now routes to the CLI instead of falling through to a raw shell. The entrypoint derives its recognised-command list at runtime from `podkit __complete commands`, so it can never drift from the binary as new commands are added — with a built-in fallback list (and a startup warning) if that probe ever fails.

Also fixes argument-injection detection for the combined `--flag=value` form: `sync --device=/dev/sdb` and `init --path=/custom.toml` are now honoured instead of having `--device /ipod` / `--path /config/config.toml` wrongly appended on top.
