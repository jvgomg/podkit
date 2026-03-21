---
"@podkit/core": patch
---

Fix infinite metadata update loop when source collection contains duplicate tracks

When a source collection had multiple entries with the same (artist, title, album) but different track numbers, each duplicate would generate a separate metadata-correction operation against the same iPod track. After applying one update, the next sync would see the other duplicate's metadata as a diff — causing an endless update cycle.

The diff engine now skips duplicate source tracks that match an already-claimed iPod track. The first source entry wins; subsequent duplicates are ignored.
