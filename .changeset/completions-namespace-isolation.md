---
"podkit": patch
---

Fix shell completions namespace conflict when multiple podkit binaries are installed.

The `--cmd` flag now derives the completion function prefix from the binary name (`podkit-dev` → `_podkit_dev`), so `podkit` and `podkit-dev` each get an isolated namespace and their completion scripts no longer clobber each other. The `podkit-dev` binary built via `install:dev` now reports a `-dev` version suffix.
