---
"podkit": minor
---

iPod archives now record full device identity

`podkit device archive` derives the archived iPod's identity from standard artifacts and shows it in the archive `README.md` — previously most fields were blank (notably for iPod shuffles):

- **Name** comes from the iTunesDB master playlist (the iPod's own name), not the truncated disk volume label.
- **Model, generation, serial, model number, capacity, and colour** resolve from a SysInfoExtended plist via `@podkit/devices-ipod`: the on-disk file when the device carried one, otherwise a sidecar (`podkit-sysinfo-extended.xml`) captured **read-only from firmware** at dump time. This is what makes full identity available offline for devices with no on-disk SysInfo (every iPod shuffle) — without ever writing to the device.
- iPod shuffle 4th-generation identification data (Late 2012 + Mid 2015 order numbers, serial suffixes, and FamilyID) was added, so shuffles now resolve to their exact colour/capacity variant.
- The recorded **podkit version** falls back to the CLI package version instead of `unknown` when running outside the packaged binary.
- The lossless-copy directory is renamed from `raw dump/` to **`raw/`** (dumps with the old layout still load via `--from-dump`).
