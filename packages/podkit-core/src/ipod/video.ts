/**
 * Video track utilities for iPod database operations.
 *
 * Provides helpers for creating video track inputs from collection videos
 * and video source analysis data.
 */

import type { CollectionVideo } from '../video/directory-adapter.js';
import type { VideoSourceAnalysis } from '../video/types.js';
import type { TrackInput } from './types.js';
import { MediaType } from './constants.js';

/**
 * Options for creating a video track input
 */
export interface CreateVideoTrackOptions {
  /** Override the file type description (defaults to 'M4V video file') */
  filetype?: string;
  /** File size in bytes */
  size?: number;
  /** Bitrate in kbps */
  bitrate?: number;
  /** Sample rate in Hz (for audio track) */
  sampleRate?: number;
}

/**
 * Create a TrackInput for a movie video
 *
 * Sets appropriate mediaType (Movie) and movie_flag for the iPod database.
 *
 * @param video - Collection video metadata
 * @param analysis - Video source analysis with technical details
 * @param options - Additional options
 * @returns TrackInput suitable for addTrack()
 *
 * @example
 * ```typescript
 * const input = createMovieTrackInput(video, analysis, {
 *   size: transcodedSize,
 * });
 * const track = ipod.addTrack(input);
 * ```
 */
export function createMovieTrackInput(
  video: CollectionVideo,
  analysis: VideoSourceAnalysis,
  options: CreateVideoTrackOptions = {}
): TrackInput {
  return {
    title: video.title,
    artist: video.director ?? video.studio,
    album: video.title, // Movies use their title as album
    genre: video.genre,
    year: video.year,
    comment: video.description,

    // Technical info from analysis
    duration: Math.round(analysis.duration * 1000), // Convert seconds to ms
    bitrate: options.bitrate ?? analysis.videoBitrate + analysis.audioBitrate,
    sampleRate: options.sampleRate ?? analysis.audioSampleRate,
    size: options.size ?? 0,

    // File type
    filetype: options.filetype ?? 'M4V video file',
    mediaType: MediaType.Movie,

    // Video-specific fields
    movieFlag: true,
  };
}

/**
 * Create a TrackInput for a TV show episode
 *
 * Sets appropriate mediaType (TVShow) and TV-specific metadata
 * (series name, season, episode) for the iPod database.
 *
 * @param video - Collection video metadata with TV show info
 * @param analysis - Video source analysis with technical details
 * @param options - Additional options
 * @returns TrackInput suitable for addTrack()
 *
 * @example
 * ```typescript
 * const input = createTVShowTrackInput(video, analysis, {
 *   size: transcodedSize,
 * });
 * const track = ipod.addTrack(input);
 * ```
 */
export function createTVShowTrackInput(
  video: CollectionVideo,
  analysis: VideoSourceAnalysis,
  options: CreateVideoTrackOptions = {}
): TrackInput {
  // Use episode title if available, otherwise use series title with episode info
  const title = video.title || formatEpisodeTitle(video);
  const seriesTitle = video.seriesTitle ?? video.title;

  return {
    title,
    artist: seriesTitle, // Series title as artist
    album: formatSeasonAlbum(video), // "Series Name, Season X"
    genre: video.genre,
    year: video.year,
    comment: video.description,

    // Episode numbering (if available, map to track/disc numbers)
    trackNumber: video.episodeNumber,
    discNumber: video.seasonNumber,

    // Technical info from analysis
    duration: Math.round(analysis.duration * 1000), // Convert seconds to ms
    bitrate: options.bitrate ?? analysis.videoBitrate + analysis.audioBitrate,
    sampleRate: options.sampleRate ?? analysis.audioSampleRate,
    size: options.size ?? 0,

    // File type
    filetype: options.filetype ?? 'M4V video file',
    mediaType: MediaType.TVShow,

    // Video-specific fields
    tvShow: seriesTitle,
    tvEpisode: title, // Episode title stored in tvEpisode
    seasonNumber: video.seasonNumber ?? 1,
    episodeNumber: video.episodeNumber ?? 1,
    movieFlag: false,
  };
}

/**
 * Create a TrackInput for a video based on its content type
 *
 * Automatically selects movie or TV show format based on the video's
 * contentType field.
 *
 * @param video - Collection video metadata
 * @param analysis - Video source analysis with technical details
 * @param options - Additional options
 * @returns TrackInput suitable for addTrack()
 *
 * @example
 * ```typescript
 * const input = createVideoTrackInput(video, analysis, { size });
 * const track = ipod.addTrack(input);
 * ```
 */
export function createVideoTrackInput(
  video: CollectionVideo,
  analysis: VideoSourceAnalysis,
  options: CreateVideoTrackOptions = {}
): TrackInput {
  if (video.contentType === 'tvshow') {
    return createTVShowTrackInput(video, analysis, options);
  }
  return createMovieTrackInput(video, analysis, options);
}

/**
 * Format episode title from video metadata
 */
function formatEpisodeTitle(video: CollectionVideo): string {
  if (video.episodeId) {
    return `${video.episodeId} - ${video.seriesTitle ?? 'Episode'}`;
  }
  if (video.seasonNumber && video.episodeNumber) {
    const ep = String(video.episodeNumber).padStart(2, '0');
    const season = String(video.seasonNumber).padStart(2, '0');
    return `S${season}E${ep} - ${video.seriesTitle ?? 'Episode'}`;
  }
  return video.seriesTitle ?? 'Unknown Episode';
}

/**
 * Format season album name from video metadata
 *
 * Creates album name like "Series Name, Season 1"
 */
function formatSeasonAlbum(video: CollectionVideo): string {
  const seriesTitle = video.seriesTitle ?? video.title ?? 'Unknown Series';
  const seasonNumber = video.seasonNumber ?? 1;
  return `${seriesTitle}, Season ${seasonNumber}`;
}

/**
 * Check if a media type value indicates a video track
 *
 * @param mediaType - Media type flags
 * @returns true if the track is a video (Movie, TVShow, or MusicVideo)
 */
export function isVideoMediaType(mediaType: number): boolean {
  return (
    (mediaType & MediaType.Movie) !== 0 ||
    (mediaType & MediaType.TVShow) !== 0 ||
    (mediaType & MediaType.MusicVideo) !== 0
  );
}

/**
 * Get a human-readable video type name from media type flags
 *
 * @param mediaType - Media type flags
 * @returns Human-readable type name
 */
export function getVideoTypeName(mediaType: number): string {
  if ((mediaType & MediaType.Movie) !== 0) return 'Movie';
  if ((mediaType & MediaType.TVShow) !== 0) return 'TV Show';
  if ((mediaType & MediaType.MusicVideo) !== 0) return 'Music Video';
  return 'Video';
}
