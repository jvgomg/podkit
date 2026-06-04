/**
 * Audio container format helpers.
 *
 * Predicates and utilities that classify audio files by their container
 * extension. Kept here so callers across the runtime and test surface can
 * share the same definitions without coupling to the pipeline's internals.
 *
 * @module
 */

import { extname } from 'node:path';

/**
 * Check if a file path has an OGG container extension (.opus, .ogg).
 *
 * Originally introduced because FFmpeg's OGG muxer cannot write image
 * streams (upstream tickets #4448, #9044), so the pipeline routed OGG/Opus
 * artwork through node-taglib-sharp. TASK-372 generalised that path —
 * every embedded-sink container now goes through the tag writer — so the
 * predicate is no longer used inside `transferArtwork`. Kept exported for
 * the e2e matrix's `artworkContainerRank` and for any caller that needs
 * to identify the OGG family by extension.
 */
export function isOggExtension(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === '.opus' || ext === '.ogg';
}
