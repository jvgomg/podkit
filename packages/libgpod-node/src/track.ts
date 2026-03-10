/**
 * Track-related utilities.
 *
 * This module provides helper functions for working with track metadata.
 */

import type { Track, TrackInput } from './types';
import { MediaType } from './types';

/**
 * Rating step value (20 = 1 star, 40 = 2 stars, etc.)
 */
export const RATING_STEP = 20;

/**
 * Convert star rating (0-5) to iPod rating value (0-100).
 *
 * @param stars Number of stars (0-5)
 * @returns Rating value for iPod (0-100)
 */
export function starsToRating(stars: number): number {
  const clamped = Math.max(0, Math.min(5, Math.round(stars)));
  return clamped * RATING_STEP;
}

/**
 * Convert iPod rating value (0-100) to star rating (0-5).
 *
 * @param rating iPod rating value
 * @returns Number of stars (0-5)
 */
export function ratingToStars(rating: number): number {
  return Math.floor(rating / RATING_STEP);
}

/**
 * Format track duration in mm:ss format.
 *
 * @param durationMs Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format track duration in h:mm:ss format for long tracks.
 *
 * @param durationMs Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatDurationLong(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return formatDuration(durationMs);
}

/**
 * Check if a track is an audio track.
 */
export function isAudioTrack(track: Track): boolean {
  return (track.mediaType & MediaType.Audio) !== 0;
}

/**
 * Check if a track is a video.
 */
export function isVideoTrack(track: Track): boolean {
  return (track.mediaType & MediaType.Movie) !== 0;
}

/**
 * Check if a track is a podcast.
 */
export function isPodcast(track: Track): boolean {
  return (track.mediaType & MediaType.Podcast) !== 0;
}

/**
 * Check if a track is an audiobook.
 */
export function isAudiobook(track: Track): boolean {
  return (track.mediaType & MediaType.Audiobook) !== 0;
}

/**
 * Check if a track is a music video.
 */
export function isMusicVideo(track: Track): boolean {
  return (track.mediaType & MediaType.MusicVideo) !== 0;
}

/**
 * Check if a track is a TV show.
 */
export function isTVShow(track: Track): boolean {
  return (track.mediaType & MediaType.TVShow) !== 0;
}

/**
 * Get a display string for a track (Artist - Title).
 */
export function trackDisplayName(track: Track): string {
  const artist = track.artist || 'Unknown Artist';
  const title = track.title || 'Unknown Title';
  return `${artist} - ${title}`;
}

/**
 * Create a TrackInput from partial track metadata.
 *
 * @param title Track title (required)
 * @param metadata Additional metadata
 * @returns TrackInput object
 */
export function createTrackInput(title: string, metadata?: Omit<TrackInput, 'title'>): TrackInput {
  return {
    title,
    ...metadata,
  };
}

/**
 * Estimate file size for audio based on duration and bitrate.
 *
 * @param durationMs Duration in milliseconds
 * @param bitrateKbps Bitrate in kbps
 * @returns Estimated file size in bytes
 */
export function estimateFileSize(durationMs: number, bitrateKbps: number): number {
  const durationSeconds = durationMs / 1000;
  const bitsPerSecond = bitrateKbps * 1000;
  const totalBits = durationSeconds * bitsPerSecond;
  return Math.ceil(totalBits / 8);
}

/**
 * Convert iPod path (colon-separated) to filesystem path (slash-separated).
 *
 * @param ipodPath iPod-style path (e.g., ":iPod_Control:Music:F00:ABCD.mp3")
 * @returns Filesystem path
 */
export function ipodPathToFilePath(ipodPath: string): string {
  // Remove leading colon and replace colons with slashes
  return ipodPath.replace(/^:/, '').replace(/:/g, '/');
}

/**
 * Convert filesystem path to iPod path (colon-separated).
 *
 * @param filePath Filesystem path
 * @returns iPod-style path
 */
export function filePathToIpodPath(filePath: string): string {
  // Remove leading slash and replace slashes with colons, then add leading colon
  return ':' + filePath.replace(/^\//, '').replace(/\//g, ':');
}
