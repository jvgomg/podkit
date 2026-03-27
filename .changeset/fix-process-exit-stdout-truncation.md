---
"podkit": patch
---

Fix stdout truncation when piping CLI output to another process. Commands that used `process.exit(1)` could terminate before stdout buffers flushed, truncating JSON output (e.g. `podkit init --json | node -e ...`). All error exit paths now use `process.exitCode = 1` and return normally, allowing Node.js to drain streams before exiting.
