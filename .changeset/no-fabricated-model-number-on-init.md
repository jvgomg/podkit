---
'@podkit/libgpod-node': minor
'@podkit/core': minor
'podkit': minor
---

`device init`, `device reset` and `device add` no longer stamp a fabricated iPod Video identity onto the device.

Initialising an iPod database writes the model number it is given to `iPod_Control/Device/SysInfo` as `ModelNumStr`. That value defaulted to `MA147` — an iPod Video 60GB — and every podkit caller took the default. So `podkit device reset` on *any* iPod left it claiming to be an iPod Video, with no backup and no marking, and podkit then read its own fabrication back as evidence of what the device was: it fed the identity cascade, and it silently satisfied the empty-identity refusal on a later `device add`.

The default is gone. podkit now passes the model number its identity cascade resolved from the device, and when the cascade resolves none, initialisation writes no SysInfo at all rather than inventing one. A device with unresolved identity keeps whatever identity it already had.

Two consequences of initialising without a model number, both of which podkit now handles:

- The database layer writes a playback database (`iTunesSD`) for *any* device it is given no model number for, in the `bdhs` format of an iPod shuffle 3G/4G. podkit deletes that file after initialising: a playback database for a device nothing has identified, in a format nothing has confirmed the hardware reads, is worse than none. A device that already had one keeps it. Initialising an iPod shuffle whose model number is unknown is now refused outright, pointing at `podkit doctor --repair sysinfo-extended` — that reads the device's own serial from firmware, which resolves the model number.
- `iPod_Control/Artwork` and `Photos/Thumbs` are no longer pre-created, because the database layer only creates them for a device whose model it knows. Both are created on demand by whatever writes to them, so nothing changes in practice.

Breaking for `@podkit/libgpod-node` consumers: `Database.initializeIpod()` (and `initializeIpodSync()`) no longer default `options.model` to `MA147`. Callers that relied on that default — including anything creating synthetic test iPods — must pass `model` explicitly.
