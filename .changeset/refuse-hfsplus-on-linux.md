---
"podkit": minor
"@podkit/core": minor
---

Refuse HFS+ iPods on Linux at `device add`; warn at `device scan`

iPods formatted as HFS+ are now refused on Linux at `podkit device add` time, with a clear message pointing at docs explaining how to reformat to FAT32. `podkit device scan` surfaces the same iPods with a `Filesystem not supported on Linux` warning instead of running readiness stages or suggesting destructive remediation. macOS HFS+ behaviour is unchanged.

Why: the Linux kernel hfsplus driver refuses RW on journaled HFS+ (the iPod default), udev/blkid don't surface a filesystem UUID for HFS+ on Linux (breaking podkit's identity model), and udisksctl mount paths fall back to a generic name with no label. Each friction point has a partial fix; together they mean Linux + HFS+ is a second-class experience no matter how much we patch. Refusing cleanly with a docs link sharpens podkit's Linux story to "FAT32 iPods, supported well."

Structured `--json` output preserves a stable error code (`UNSUPPORTED_FILESYSTEM_ON_LINUX`) so scripted callers can handle the refusal.
