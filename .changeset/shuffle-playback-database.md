---
'@podkit/devices-ipod': minor
'@podkit/core': minor
'podkit': minor
---

Sync to an iPod shuffle now produces a device that plays.

An iPod shuffle plays from `iTunesSD`, not from the `iTunesDB` every other iPod uses. The database layer writes that file only for a device it has resolved to a shuffle, and it resolves models from its own serial-suffix table and the classic SysInfo `ModelNumStr` alone — it has no USB or FamilyID axis. A shuffle 2G whose serial suffix is in neither table and which carries no classic SysInfo was therefore unidentifiable to it: `iTunesSD` was silently skipped, the sync reported success, and the device could not play a single one of the tracks it had just received.

podkit now supplies the identity the database layer is missing, using a model number its own cascade resolved **from the device**:

- Serial suffix `436` → `A947` (iPod shuffle 2G, 1GB, Pink) is added to the serial table from real hardware.
- `podkit device add` records the resolved model number in the device's SysInfo when the database layer cannot identify it.
- `podkit doctor` reports the same condition as a new `sysinfo-modelnum-missing` check, repairable with `podkit doctor --repair sysinfo-modelnum-missing`.
- A new `shuffle-playback-db` doctor check reports a shuffle whose `iTunesSD` is absent, empty, or in the wrong format for the hardware — the symptoms that were previously invisible. It reads the header rather than guessing from file size, because an empty 3G/4G `bdhs` file is larger than a populated 1G/2G one.

Nothing is ever fabricated: when the cascade resolves no model number, podkit reports the gap and writes nothing.

Shuffle 3G/4G remain read-only.
