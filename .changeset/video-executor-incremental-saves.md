---
"@podkit/core": patch
---

Add incremental database saves during video sync, saving every 10 completed transfers by default. Reduces data loss if the process is interrupted during a large video sync.
