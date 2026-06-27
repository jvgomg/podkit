---
"podkit": minor
"@podkit/core": minor
---

Treat encoding-mode flips (CBR↔VBR) and the lossy/lossless boundary as correctness re-encodes, applied even when bitrate syncing is off.

Switching a device's encoding mode (`vbr` ↔ `cbr`), or switching its target between lossy and lossless, is now treated as a correctness re-encode rather than a bitrate-policy move:

- **Encoding-mode flips re-encode lossy tracks too.** Previously only lossless-source tracks picked up a CBR↔VBR change; a lossy track podkit had transcoded (e.g. one already capped down to AAC) kept its old encoding mode. It now re-encodes to match.
- **Switching to a lossy target re-encodes a still-lossless device copy down to the cap.** The lossy→lossless direction already worked; the lossless→lossy direction now does too.

Both apply in **every** `bitrate.sync` mode, including `off` — freezing bitrates keeps your bitrates put but still lets a wrong encoding mode or a crossed lossy/lossless boundary be corrected. The `--skip-upgrades` master switch still blocks them, for a purely-additive device. Re-encodes are idempotent: the rewritten sync tag records the new encoding and bitrate, so the next sync is a no-op.
