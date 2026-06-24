---
"podkit": minor
---

Add per-device default collections

Each configured device can now declare its own default music and video collection, so `podkit sync -d <device>` syncs the right collections without passing `-c` every time. Each default is a tri-state: a collection name, `false` to sync nothing of that type by default, or unset to inherit the global `[defaults]`. A per-device default applies whenever the target resolves to a configured device (by name, path, or UUID auto-match); a `-c` flag still overrides everything.

Set them with `podkit device set -d <device> --default-music <name>` / `--default-video <name>`, opt a type out with `--no-default-music` / `--no-default-video`, or clear back to the global default with `--clear-default-music` / `--clear-default-video`. The resolved defaults (with provenance — explicit, `[inherited]`, `none`, or unset) are shown in `podkit device info` and `podkit device list`, in both text and JSON output.
