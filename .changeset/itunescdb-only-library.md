---
'@podkit/core': patch
'podkit': patch
---

Recognise an iPod library that only has the compressed `iTunesCDB`, as Apple software leaves it on an iPod nano 6th/7th generation. Such devices were reported as uninitialised, and `podkit device scan`/`sync` suggested `podkit device init`.
