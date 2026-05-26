/**
 * Helper utilities for E2E tests.
 */

export {
  runCli,
  runCliJson,
  isCliAvailable,
  getCliPath,
  createTempConfig,
  cleanupTempConfig,
  type CliResult,
  type CliOptions,
  type CliJsonResult,
} from './cli-runner';

export {
  getFixturesDir,
  getAlbumDir,
  getTrackPath,
  getTrack,
  getAlbumTracks,
  getAllTracks,
  Albums,
  Tracks,
  type AlbumDir,
  type TestTrack,
} from './fixtures';

export { runHostPreflightChecks, printResults, type CheckResult } from './preflight';

export { expectCliError, type CliErrorJson, type ExpectCliErrorMatch } from './cli-error';

export {
  getVideoFixturesDir,
  getVideoPath,
  getVideo,
  getAllVideos,
  getVideosByCategory,
  getTranscodeVideos,
  getPassthroughVideos,
  getMovies,
  getTVShows,
  createVideoSourceDir,
  createOrganizedVideoSourceDir,
  cleanupVideoSourceDir,
  withVideoSourceDir,
  withOrganizedVideoSourceDir,
  Videos,
  VideoCategories,
  type TestVideo,
  type VideoCategory,
} from './video-fixtures';
