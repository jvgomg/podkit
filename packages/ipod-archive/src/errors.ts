/**
 * Typed errors for `@podkit/ipod-archive`.
 *
 * Per the repo convention, library code signals failure through typed errors
 * (never `console.*` / stderr). Each error carries a stable `code` so callers
 * (the CLI runtime, tests) can branch on it without string matching.
 */

export type IpodArchiveErrorCode =
  /** The supplied volume root does not exist or is not a readable directory. */
  | 'VOLUME_NOT_READABLE'
  /** The destination directory could not be created or written. */
  | 'DEST_NOT_WRITABLE'
  /**
   * The supplied dump path could not be read as an iPod dump: no `iPod_Control`
   * directory was found inside it, or libgpod could not parse the iTunesDB.
   */
  | 'DUMP_NOT_READABLE'
  /**
   * The dump's `ArtworkDB` is present but could not be parsed: a missing
   * `mhfd` header, or a record running past the end of the buffer.
   */
  | 'ARTWORK_DB_MALFORMED'
  /**
   * A playlist member's exported path was not archive-relative (e.g. absolute),
   * so it could not be turned into a relative `.m3u8` entry. Signals a planner /
   * transform inconsistency; the affected playlist is recorded as a failure.
   */
  | 'PLAYLIST_PATH_INVALID';

/**
 * Base class for all errors thrown out of `@podkit/ipod-archive`.
 *
 * `cause` is preserved (via the standard `Error` options bag) so the original
 * IO error is not lost when the CLI renders the failure.
 */
export class IpodArchiveError extends Error {
  readonly code: IpodArchiveErrorCode;

  constructor(code: IpodArchiveErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IpodArchiveError';
    this.code = code;
  }
}
