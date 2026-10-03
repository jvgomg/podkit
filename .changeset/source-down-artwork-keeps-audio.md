---
"podkit": patch
"@podkit/core": patch
---

Keep the device's better audio when a re-ripped track gains artwork

If you replaced a track in your collection with a lower-bitrate copy, podkit already kept the better copy on the device and reported it as "Source-down suppressed". But if that new copy also had artwork the device copy lacked, podkit copied the worse audio onto the device along with the artwork, and did not report it.

podkit now adds the artwork to the existing device track without touching its audio, and the track appears in the "Source-down suppressed" report.
