---
'@podkit/libgpod-node': patch
'@podkit/devices-ipod': minor
'podkit': minor
---

podkit now syncs the iPod nano 7th generation, confirmed on a device with firmware 1.0.4. Its libgpod build writes the hidden category containers and iTunes' schema level that the nano 7th generation needs to show a library, and keeps the plays, skips, ratings and bookmarks the device records across syncs. The nano 6th generation stays read-only: its library writes are covered only by synthetic tests, which its unsupported-device message now says.
