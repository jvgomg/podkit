/**
 * iPod database abstraction layer.
 *
 * This module provides a clean interface for iPod operations without
 * exposing libgpod-node internals.
 *
 * @example
 * ```typescript
 * import {
 *   IpodDatabase,
 *   IpodError,
 *   MediaType,
 *   type IPodTrack,
 *   type IpodPlaylist,
 * } from '@podkit/core';
 *
 * const ipod = await IpodDatabase.open('/Volumes/IPOD');
 *
 * // Add a track
 * const track = ipod.addTrack({
 *   title: 'Song Title',
 *   artist: 'Artist Name',
 *   mediaType: MediaType.Audio,
 * });
 *
 * // Copy audio file to iPod
 * track.copyFile('/path/to/song.mp3');
 *
 * // Save changes
 * await ipod.save();
 * ipod.close();
 * ```
 */

// Type exports
export type {
  TrackInput,
  TrackFields,
  IPodTrack,
  IpodPlaylist,
  IpodDeviceInfo,
  IpodInfo,
  SaveResult,
  RemoveTrackResult,
  RemoveAllTracksResult,
  RemoveTracksByContentTypeResult,
} from './types.js';

// Error exports
export { IpodError } from './errors.js';
export type { IpodErrorCode } from './errors.js';

// Constant exports
export { MediaType, isMusicMediaType } from './constants.js';
export type { MediaTypeValue, ContentType } from './constants.js';

// Implementation exports
export { IpodDatabase } from './database.js';

export { IpodTrackImpl } from './track.js';
export type { IpodDatabaseInternal } from './track.js';

export { IpodPlaylistImpl } from './playlist.js';
export type { PlaylistDatabaseInternal } from './playlist.js';

// Video utilities
export {
  createVideoTrackInput,
  createMovieTrackInput,
  createTVShowTrackInput,
  isVideoMediaType,
  getVideoTypeName,
} from './video.js';
export type { CreateVideoTrackOptions } from './video.js';

// Generation utilities
export {
  IPOD_GENERATIONS,
  formatGeneration,
  getVideoProfile,
  supportsVideo,
} from './generation.js';
export type { IpodGenerationMetadata } from './generation.js';
