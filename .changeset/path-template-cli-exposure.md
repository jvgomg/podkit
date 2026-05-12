---
"podkit": minor
---

Expose `pathTemplate` as a per-device config option for mass-storage devices, allowing user-customisable folder structures.

Configurable via:

- `[devices.<name>] pathTemplate = "..."` in TOML
- `PODKIT_PATH_TEMPLATE` env var (applied as a global default for mass-storage devices)

Variables: `{albumArtist}`, `{artist}`, `{album}`, `{title}`, `{trackNumber}`, `{discNumber}`, `{totalDiscs}`, `{genre}`, `{year}`, `{ext}`. The template must contain `{title}` and `{ext}` and is rejected on iPod devices (iPod paths are managed by libgpod, not by template).

Changing the template between syncs triggers the existing self-healing relocate flow — existing files are moved via `fs.rename()` to match the new layout, with no re-transcoding. Adds, removes (`--delete`), and template-driven relocates all compose in a single sync operation.
