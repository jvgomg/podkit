---
id: DRAFT-013
title: Promote runFFmpeg to shared transcode/spawn.ts (music + video dedup)
status: Draft
assignee: []
created_date: '2026-06-05 19:37'
labels:
  - refactor
  - transcode
  - code-quality
  - music-video-symmetry
dependencies: []
references:
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - packages/podkit-core/src/sync/video/handler.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-383's symmetry pass identified that the music pipeline (`FFmpegTranscoder` class) and the video pipeline (free `transcodeVideo` function) both reinvent the FFmpeg spawn lifecycle (process management, stderr capture, signal handling, exit-code mapping). Same primitive, two implementations.

## Scope

Extract the shared spawn machinery to `packages/podkit-core/src/transcode/spawn.ts`:

```ts
export interface SpawnResult {
  exitCode: number;
  stderr: string;
}

export function spawnFFmpeg(args: string[], opts?: {
  signal?: AbortSignal;
  cwd?: string;
}): Promise<SpawnResult>;
```

Then refactor both consumers to use it:

- `FFmpegTranscoder.transcode` (music): replace inline spawn with `spawnFFmpeg`.
- `transcodeVideo` (video): replace inline spawn with `spawnFFmpeg`.

The PER-PIPELINE wrappers stay — they own arg construction, output-path management, codec-specific error mapping. Only the spawn primitive is shared.

## Acceptance criteria

- `transcode/spawn.ts` exists with a focused `spawnFFmpeg` primitive.
- Both `FFmpegTranscoder.transcode` and `transcodeVideo` consume it.
- No behaviour changes; existing transcode tests green.
- Bonus: any FFmpeg-version-detection or capability-probing primitives could share the spawn machinery too. In-scope if low effort, otherwise file as TASK-NEW.

## Reference

- TASK-383 Phase 3 symmetry finding (Worker's recommended follow-up #1).
- Decided 2026-06-05 in team-lead session.
<!-- SECTION:DESCRIPTION:END -->
