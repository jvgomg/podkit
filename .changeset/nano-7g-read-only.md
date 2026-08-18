---
'@podkit/devices-ipod': patch
'@podkit/core': patch
'podkit': patch
---

iPod nano 7th gen is now read and archived instead of refused outright.

The generation table marked nano 7G `access: 'none'` on the claim that it had no entry in libgpod's device table, so podkit could not mount a database for it. Real hardware disagrees: podkit read 1,414 tracks off a nano 7G via libgpod's classic `iTunesCDB` parser and `podkit device archive` completed successfully. The device does carry a database podkit cannot write — but the reason is unrelated to the original claim: nano 7G uses `hashAB` checksum signing, which libgpod only computes via an external blob (`LIBGPOD_BLOB_DIR`) that podkit does not ship, so it fails closed on write.

nano 7G is now `access: 'read-only'`, `verified: 'hardware'` — the same tier as the shuffle 3G/4G and nano 6G. `podkit device scan`, `device info`, `device music`, and `device archive` all work; `podkit sync` and `device init`/`add` still refuse, now with a reason describing the real hashAB limitation instead of a flat "not supported" message.
