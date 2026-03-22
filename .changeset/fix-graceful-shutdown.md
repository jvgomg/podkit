---
"podkit": patch
---

Fix graceful shutdown during sync: Ctrl+C now reliably saves completed work to the iPod database before exiting. Previously, video sync interruptions could silently skip the database save, causing the next sync to redo already-completed work. Also fix "Force quit" appearing immediately on first Ctrl+C when running via `bun run`. Ctrl+C during read-only phases (scanning, diffing) now exits instantly instead of showing a misleading "finishing current operation" message.
