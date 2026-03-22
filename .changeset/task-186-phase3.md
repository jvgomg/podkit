---
"@podkit/core": minor
---

Unify sync pipeline: CLI presenter pattern, naming symmetry, tests, and cleanup (TASK-186)

- Add ContentTypePresenter pattern for content-type-agnostic CLI sync orchestration
- Rename music-specific symbols with Music prefix (computeDiff→computeMusicDiff, DefaultSyncExecutor→MusicExecutor, etc.)
- Rename generic pipeline from Unified prefix to Sync prefix (UnifiedDiffer→SyncDiffer, UnifiedPlanner→SyncPlanner, UnifiedExecutor→SyncExecutor)
- Remove unused handler registry (registerHandler, getHandler, getAllHandlers, clearHandlers)
- Remove dead video pipeline code (PlaceholderVideoSyncExecutor, createVideoExecutor)
- Fix TranscodeProgress.speed type inconsistency (string→number)
- Add 'space-constraint' to SyncWarningType union
- Add completedCount to ExecutorProgress
- Add 47 new tests for VideoHandler, MusicHandler, and SyncExecutor
- All old symbol names preserved as backward-compatible aliases
