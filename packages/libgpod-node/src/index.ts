/**
 * @podkit/libgpod-node
 *
 * Native Node.js bindings for libgpod.
 * Provides access to iPod database operations.
 *
 * @example
 * ```typescript
 * import { Database } from '@podkit/libgpod-node';
 *
 * // Open an iPod database
 * const db = await Database.open('/media/ipod');
 *
 * // Get database info
 * console.log(`Found ${db.trackCount} tracks on ${db.device.modelName}`);
 *
 * // List all tracks
 * for (const track of db.getTracks()) {
 *   console.log(`${track.artist} - ${track.title}`);
 * }
 *
 * // Add a new track (metadata only)
 * const newTrack = db.addTrack({
 *   title: 'My Song',
 *   artist: 'My Artist',
 *   album: 'My Album',
 * });
 *
 * // Save changes
 * await db.save();
 *
 * // Clean up
 * db.close();
 * ```
 *
 * @packageDocumentation
 */

export const VERSION = '0.0.0';

// Main database class
export { Database } from './database';

// Types
export type {
  // Core types
  Track,
  TrackInput,
  Playlist,
  DeviceInfo,
  DatabaseInfo,
  ArtworkCapabilities,

  // Enums and type aliases
  IpodGeneration,
  IpodModel,
  MediaTypeValue,
} from './types';

export {
  // Error handling
  LibgpodError,
  LibgpodErrorCode,

  // Constants
  MediaType,
} from './types';

// Track utilities
export {
  // Rating conversion
  starsToRating,
  ratingToStars,
  RATING_STEP,

  // Duration formatting
  formatDuration,
  formatDurationLong,

  // Media type checks
  isAudioTrack,
  isVideoTrack,
  isPodcast,
  isAudiobook,
  isMusicVideo,
  isTVShow,

  // Display helpers
  trackDisplayName,
  createTrackInput,

  // File size estimation
  estimateFileSize,

  // Path conversion
  ipodPathToFilePath,
  filePathToIpodPath,
} from './track';

// Native binding utilities (for advanced use)
export {
  isNativeAvailable,
  getVersion as getNativeVersion,
} from './binding';
