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
} from './types.js';

// Error exports
export { IpodError } from './errors.js';
export type { IpodErrorCode } from './errors.js';

// Constant exports
export { MediaType } from './constants.js';
export type { MediaTypeValue } from './constants.js';
