---
title: "ADR-011: Prefetch Pipeline for Remote Sources"
description: Three-stage pipeline architecture to overlap network downloads with transcoding for remote collection sources.
sidebar:
  order: 12
---

# ADR-011: Prefetch Pipeline for Remote Sources

## Status

**Accepted** (2026-03-16)

## Context

When syncing from remote sources (Subsonic), the executor's producer processes each track sequentially: download file, transcode with FFmpeg, push to transfer queue. Network is idle during transcoding and CPU is idle during downloading. The existing two-stage pipeline (producer → consumer via AsyncQueue) overlaps transcoding with USB transfer, but doesn't overlap downloading with transcoding within the producer.

## Decision Drivers

- **Throughput**: Eliminate dead time between network I/O and CPU work for remote sources
- **Bounded resources**: Backpressure must prevent unbounded downloading
- **Interface stability**: No changes to adapter or transcoder interfaces
- **Backward compatibility**: Local adapters (DirectoryAdapter) must work identically

## Options Considered

### Option A: Three-stage prefetch pipeline

Split the producer into a downloader task and a preparer task with an AsyncQueue between them. The downloader fetches files from the remote source and enqueues local file paths; the preparer dequeues, transcodes, and pushes to the existing transfer queue.

### Option B: FFmpeg stdin piping (`pipe:0`)

Pipe the download stream directly into FFmpeg. Overlaps download and transcode for the same track but doesn't help inter-track pipelining. Breaks artwork extraction (needs file path for music-metadata). Requires transcoder interface changes.

### Option C: Adapter-level prefetch

Add prefetch/warmup methods to the adapter interface. Leaks pipeline concerns into the adapter abstraction.

### Option D: Simple look-ahead

Manually start downloading track N+1 while transcoding track N. Ad-hoc version of Option A with worse edge case handling.

## Decision

**Option A — three-stage pipeline.** Split the existing producer into a downloader task and a preparer task, connected by a bounded prefetch queue (AsyncQueue with buffer size 2). The existing transfer queue (buffer size 3) between preparer and consumer remains unchanged.

- For local adapters, the downloader resolves file paths instantly, so the prefetch queue fills immediately and the pipeline collapses to the existing two-stage behavior.
- Maximum temp files on disk: 6 (2 prefetch + 1 transcoding + 3 transfer) ≈ ~180 MB for typical FLAC files.
- Backpressure flows end-to-end: USB slow → transfer queue full → preparer blocks → prefetch queue full → downloader blocks.

## Consequences

### Positive

- Network and CPU work overlap across tracks, eliminating dead time for remote sources
- Bounded resource usage via backpressure prevents unbounded downloading
- No adapter or transcoder interface changes required
- Transparent for local sources — pipeline collapses to existing two-stage behavior

### Negative

- Slightly more complex executor (three concurrent tasks vs two)
- Up to 6 temp files on disk simultaneously

## Related Decisions

- [ADR-004](./adr-004-collection-sources.md) — Collection Sources (adapter pattern)
- [ADR-007](./adr-007-subsonic-collection-source.md) — Subsonic Collection Source
