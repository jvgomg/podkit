---
"@podkit/daemon": patch
---

Detect whole-disk-formatted iPods in the daemon poller

The daemon's device poller only recognised an iPod on a partition (lsblk `type: "part"`), so an iPod whose filesystem is written to a bare whole disk with no partition table — e.g. an iPod shuffle — was never detected and the daemon polled indefinitely without syncing it. This brings the daemon poller in line with the device scan/enumeration path, which already surfaces partitionless whole-disk iPods. The poller now also accepts a whole-disk volume (`type: "disk"` carrying a filesystem with no partition children), still preferring partitions over their parent disk when both are present and excluding loop devices; the iPod match (vfat + Apple vendor id) is unchanged.
