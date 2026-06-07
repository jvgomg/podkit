---
'podkit': minor
'@podkit/core': minor
---

Unify `--repair` IDs across device types and add debris-only diagnostic checks.

The `podkit doctor --repair` flag now uses one ID per repair regardless of device type. Internally, the framework dispatches the right walker based on the connected device:

- `--repair orphan-files` — works on both iPod and mass-storage. (Previously `orphan-files` was iPod-only; `orphan-files-mass-storage` was the mass-storage variant.)
- `--repair debris-files` (new) — cleans podkit's own `.podkit-tmp` and adapter-failure write residue from prior interrupted syncs. Repair is safe-by-design (no confirmation prompt) because every debris file is incomplete by construction.
- `--repair debris-transcode-tmp` (new) — reaps abandoned `podkit-transcode-*` scratch directories from SIGKILLed prior syncs. Uses an mtime-based safety floor so concurrent sibling processes are never disturbed.

**Breaking:** `--repair orphan-files-mass-storage` has been **removed**. Users running this flag will see Commander's choices() validation error listing the new public IDs (including `orphan-files`). Migration is mechanical: replace every occurrence with `--repair orphan-files`.

The orphan check no longer reports debris in its detail output — that's the new `debris-files` check's job. Same FS walk, two checks; no double traversal.
