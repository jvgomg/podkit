---
"@podkit/core": minor
"podkit": minor
---

`device rename` now relabels the on-disk volume in addition to the iTunesDB name.

Renaming an iPod previously only updated the iTunesDB master-playlist name (what the iPod firmware displays). `podkit device rename <name>` now also writes the OS volume label by default, so the Finder/Explorer name matches.

- New pure `labelFromName(name, fs)` derives the volume label from the device name per filesystem: FAT folds to uppercase, strips illegal characters, and truncates to 11 characters (reporting a `lossy` flag + human warning); HFS+ preserves case and allows long names. Plus `classifyVolumeFilesystem` to map OS filesystem strings onto the rule family.
- New `DeviceManager.detectFilesystem(path)` and `DeviceManager.setVolumeLabel(path, label)` select the right OS tool (macOS `diskutil rename`; Linux `fatlabel` / `hfslabel`). Failures surface as a typed `VolumeLabelError`.
- `applyDeviceName` completes its disk branch: writes the DB name first, relabels the volume last (relabeling moves the mountpoint), then re-resolves the mountpoint. The filesystem-detect, relabel, and mountpoint-resolution steps are injectable seams with real defaults.
- `--no-disk` skips the relabel; `--no-database` skips the iTunesDB name; both together still errors as a no-op. When the FAT label is lossy, the CLI surfaces a warning showing what the on-disk label became.
