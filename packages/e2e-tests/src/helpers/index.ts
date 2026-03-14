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
  areFixturesAvailable,
  Albums,
  Tracks,
  type AlbumDir,
  type TestTrack,
} from './fixtures';

export { runPreflightChecks, printResults, type CheckResult } from './preflight';

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
  areVideoFixturesAvailable,
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
