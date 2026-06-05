/**
 * Shared option/config types for the music pipeline.
 *
 * Lives in its own module so {@link ./artwork.ts | MusicArtworkManager},
 * {@link ./execution-context.ts | ExecutionContext}, and
 * {@link ./pipeline.ts | MusicPipeline} can share these types without
 * circular imports.
 *
 * @module
 */

/**
 * Configuration for writing sync tags to iPod tracks.
 *
 * When provided, sync tags are written to the comment field of transcoded
 * tracks, enabling exact preset change detection on future syncs.
 */
export interface SyncTagConfig {
  /** Encoding mode: 'vbr' | 'cbr' */
  encodingMode?: string;
  /** Custom bitrate override (only when explicitly set by user) */
  customBitrate?: number;
}
