/**
 * @podkit/ipod-archive — archive a connected iPod into a self-contained,
 * checksummed, browsable directory.
 *
 * Stage 1 (this surface): a read-only raw dump of the iPod's whitelisted data,
 * hashed through SHA-256 into a `shasum -c`-compatible manifest. macOS junk and
 * user-added "foreign" files are classified out and reported, never copied.
 *
 * Leaf package: depends only on `@podkit/libgpod-node`, `@podkit/ipod-firmware`,
 * and `@podkit/device-types`. It never reaches into `@podkit/core` or the CLI.
 *
 * @module
 */

// ── Errors ─────────────────────────────────────────────────────────────────
export { IpodArchiveError, type IpodArchiveErrorCode } from './errors.js';

// ── Volume classification ───────────────────────────────────────────────────
export {
  classifyEntries,
  isJunkEntry,
  isWhitelistEntry,
  IPOD_DATA_WHITELIST,
  type VolumeClassification,
} from './volume-classifier.js';

// ── Raw dump ────────────────────────────────────────────────────────────────
export {
  dump,
  formatManifest,
  MANIFEST_FILENAME,
  type ManifestEntry,
  type DumpFailure,
  type RawDumpResult,
} from './raw-dumper.js';

// ── Output-directory naming ─────────────────────────────────────────────────
export {
  buildOutputDirName,
  formatTimestamp,
  resolveIdentityToken,
  sanitizeSegment,
  type OutputNameIdentity,
} from './output-naming.js';

// ── Path sanitisation (shared) ───────────────────────────────────────────────
// `sanitizeSegment` (compact, underscore policy) is re-exported above via
// output-naming. `sanitizePathSegment` (space-preserving) is the music-tree
// variant.
export { sanitizePathSegment } from './sanitize.js';

// ── iPod path conversion ──────────────────────────────────────────────────────
export {
  ipodPathToRelativeSegments,
  resolveDumpAudioPath,
  ipodPathExtension,
  ipodPathBasename,
} from './ipod-path.js';

// ── Archive path planning ─────────────────────────────────────────────────────
export {
  planPath,
  createCollisionState,
  toPlannerTrack,
  classifyMediaType,
  MUSIC_SUBDIR,
  COMPILATIONS_SUBDIR,
  PODCASTS_SUBDIR,
  AUDIOBOOKS_SUBDIR,
  VIDEO_SUBDIR,
  MOVIES_SUBDIR,
  MUSIC_VIDEOS_SUBDIR,
  TV_SHOWS_SUBDIR,
  type PlannerTrack,
  type CollisionState,
  type MediaKind,
} from './archive-path-planner.js';

// ── Tag writing ────────────────────────────────────────────────────────────────
export {
  writeTrack,
  type TrackTagMeta,
  type WriteTrackResult,
  type WriteTrackOptions,
  type TagWriteOutcome,
} from './tag-writer.js';

// ── Artwork ──────────────────────────────────────────────────────────────────
export {
  createArtworkDecoder,
  type ArtworkDecoder,
  type ArtworkInfo,
} from './artwork/artwork-decoder.js';
export { parseArtworkDatabase } from './artwork/artwork-db.js';
export { extractThumbnail } from './artwork/ithmb.js';
export {
  decodeRgb565,
  decodeRgb555,
  decodeRgb888,
  getDecoder,
  getBytesPerPixel,
  type PixelDecoder,
} from './artwork/pixel-formats.js';
export { rgbaToPng } from './artwork/rgba-to-png.js';
export type {
  ArtworkDatabase,
  ArtworkImage,
  ArtworkThumbnail,
  DecodedImage,
} from './artwork/types.js';

// ── SQLite catalogue ──────────────────────────────────────────────────────────
export {
  writeLibraryDb,
  flattenSmartRule,
  LIBRARY_DB_FILENAME,
  LIBRARY_DB_SCHEMA_VERSION,
  type WriteLibraryDbOptions,
  type TrackPathInfo,
} from './library-db-writer.js';

// ── Playlists (m3u8) ──────────────────────────────────────────────────────────
export {
  writePlaylists,
  serializePlaylistM3u8,
  playlistRelativePath,
  trackExtinf,
  uniquePlaylistBaseName,
  PLAYLISTS_SUBDIR,
  type WritePlaylistsOptions,
  type WritePlaylistsResult,
  type WrittenPlaylist,
  type PlaylistEntry,
  type PlaylistLine,
  type SkippedPlaylistEntry,
  type PlaylistFailure,
} from './playlist-writer.js';

// ── Report + README ───────────────────────────────────────────────────────────
export {
  ArchiveReport,
  computeLibraryStats,
  renderReadme,
  formatBytes,
  formatDuration,
  REPORT_MARKDOWN_LIST_CAP,
  README_TOP_ARTISTS,
  type ReportStage1,
  type ReportStage2,
  type ReportJson,
  type ReportDumpFailure,
  type ReportTrackSkip,
  type ReportTransformFailure,
  type ReportPlaylistFailure,
  type LibraryStats,
  type ArtistTrackCount,
  type RenderReadmeOptions,
} from './archive-report.js';

// ── Dump loading ───────────────────────────────────────────────────────────────
export { loadDump, type LoadedDump, type DumpDeviceIdentity } from './dump-loader.js';

// ── Orchestrators ──────────────────────────────────────────────────────────────
export {
  runDump,
  RAW_DUMP_SUBDIR,
  REPORT_MD_FILENAME as DUMP_REPORT_MD_FILENAME,
  REPORT_JSON_FILENAME as DUMP_REPORT_JSON_FILENAME,
  type RunDumpOptions,
  type DumpIdentity,
  type DumpResult,
} from './run-dump.js';

export {
  runTransform,
  ARCHIVE_SUBDIR,
  README_FILENAME,
  REPORT_MD_FILENAME,
  REPORT_JSON_FILENAME,
  type RunTransformOptions,
  type TransformResult,
  type TransformSkip,
  type TransformFailure,
  type TransformTagFailure,
} from './run-transform.js';

export { runArchive, type RunArchiveOptions, type ArchiveResult } from './run-archive.js';

// ── Progress events ───────────────────────────────────────────────────────────
export type {
  ArchiveProgressEvent,
  ArchiveProgressCallback,
  TransformStats,
} from './progress-events.js';
