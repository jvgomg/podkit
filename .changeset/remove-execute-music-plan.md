---
'@podkit/core': minor
---

Remove `executeMusicPlan` library convenience.

`executeMusicPlan` bypassed the engine `SyncExecutor` and carried subtly different save semantics (no checkpoint cadence) after ADR-019 P1 landed. Library callers should drive `MusicPipeline` through `createSyncExecutor(createMusicHandler(...))` for engine-owned save coordination, or instantiate `new MusicPipeline(deps)` and iterate `execute()` directly for minimal aggregation needs.
