---
"podkit": minor
---

Archive now records real device identity

`podkit device archive` resolves the connected iPod's full identity while it's live — the same identification stack `device info` uses — and persists it into the dump as `podkit-device.json`. The archive's `README.md` then shows the real model, generation, and serial instead of dashes.

This fixes devices whose identity exists only over USB (every iPod shuffle carries no on-disk `SysInfo`): a shuffle archive that previously showed `Model: —` now shows `iPod shuffle (4th Generation)`. For iPods that do carry a `SysInfo` file, a bare `--from-dump` transform also resolves the model offline via `@podkit/devices-ipod`, identifying models libgpod's older table returns `Invalid` for.
