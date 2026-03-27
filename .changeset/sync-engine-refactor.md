---
"@podkit/core": minor
"podkit": minor
---

Refactor sync engine to be fully content-type-agnostic with per-handler operation types.

**Breaking:** `createMusicHandler()` and `createVideoHandler()` now take a config object at construction instead of using `setTransformsConfig()`/`setExecutionConfig()`. Removed `HandlerDiffOptions`, `HandlerPlanOptions`, `MusicExecutionConfig` types. Renamed `MusicExecutor` to `MusicPipeline`. Removed legacy planner functions (`createMusicPlan`, `planVideoSync` and related helpers).

**New:** `MusicSyncConfig`, `VideoSyncConfig`, `MusicTrackClassifier`, `VideoTrackClassifier`, `MusicOperationFactory`, `MusicOperation`, `VideoOperation`, `BaseOperation` types. Handlers now own their operation types via `TOp` type parameter on `ContentTypeHandler`.
