/**
 * Empty-playlist guard — the pure decision unit.
 *
 * A playlist-scoped subsonic collection that resolves to ZERO tracks would,
 * if synced unguarded, remove every track the device holds for that
 * collection — silently turning an emptied (or mistyped) server playlist
 * into a device wipe. This module decides what to do about that, with no
 * I/O of its own: callers act on the returned decision (prompt, abort, or
 * proceed).
 *
 * The decision is deliberately a pure function so its full matrix can be
 * exercised in isolation, no sync and no terminal required. It is only ever
 * consulted for PLAYLIST-SCOPED collections — an ordinary empty
 * directory/library collection keeps its existing behaviour and never
 * reaches here.
 */

/**
 * What the caller should do for a playlist-scoped collection given its
 * resolved track count and the run's interactivity / override state.
 *
 * - `proceed` — sync as normal.
 * - `confirm` — warn the user and prompt; only proceed on an explicit yes.
 * - `abort`   — stop without touching the device, non-zero exit.
 */
export type EmptyPlaylistDecision = 'proceed' | 'confirm' | 'abort';

/**
 * Inputs to {@link decideEmptyPlaylist}, beyond the resolved track count.
 */
export interface EmptyPlaylistContext {
  /**
   * True when the run can interactively prompt — i.e. attached to a TTY and
   * not emitting machine output (`--json`). Computed by the caller from the
   * output context; the guard does no detection of its own.
   */
  interactive: boolean;
  /**
   * True when the user explicitly opted into syncing an empty playlist —
   * via the `--yes` flag (one-off) or the `allowEmptyPlaylist` config key
   * (daemon). Overrides both the confirm and abort paths.
   */
  allowEmpty: boolean;
}

/**
 * Decide how a playlist-scoped sync should treat its resolved track count.
 *
 * Matrix:
 * - `trackCount > 0`                              → `proceed`
 * - `trackCount === 0` and `allowEmpty`           → `proceed`
 * - `trackCount === 0`, interactive, no override  → `confirm`
 * - `trackCount === 0`, headless, no override     → `abort`
 *
 * Pure: no prompting, no process exit, no logging. The caller maps the
 * decision onto behaviour.
 */
export function decideEmptyPlaylist(
  trackCount: number,
  context: EmptyPlaylistContext
): EmptyPlaylistDecision {
  if (trackCount > 0) {
    return 'proceed';
  }
  if (context.allowEmpty) {
    return 'proceed';
  }
  return context.interactive ? 'confirm' : 'abort';
}
