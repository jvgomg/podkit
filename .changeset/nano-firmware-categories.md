---
'@podkit/libgpod-node': patch
---

For the iPod nano 6th and 7th generation, libgpod now writes the hidden category containers (Music, Videos, …) and iTunes' database schema level that the nano 7th generation firmware needs to show a library, and keeps the Videos category's identity in the `iTunesCDB`. Such a write fails, instead of leaving a library the device cannot browse, when the device's SQLite post-process commands are missing or fail or when a database cannot be written completely.
