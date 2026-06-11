/**
 * Per-check failure-explanation copy for the doctor renderer.
 *
 * The diagnostic check itself (`@podkit/core`) returns structured
 * `details: Record<string, unknown>`; this module translates per-check
 * structures into the human-readable detail lines the doctor's issues
 * section renders under each failing check.
 *
 * Owning the words CLI-side (rather than pushing string builders into
 * `@podkit/core`) keeps core a structured-data interface — other apps
 * (future web/GUI) can read the same `details` and render their own
 * presentation without inheriting our wording choices.
 *
 * Registry is open/closed: adding copy for a new check id is a single
 * entry here, not an edit to a giant if-ladder inside the renderer.
 *
 * Routing contract (pinned by `doctor-failure-copy-routing.test.ts`):
 * each check id renders ONLY its own copy. A previous inline if-ladder
 * had a fall-through bug that made every failing check show artwork
 * wording — explicit dispatch by id prevents that drift.
 */

/**
 * Status of a check whose failure copy we may want to render.
 *
 * Most copy is gated on `fail`, but some checks (notably
 * `sysinfo-modelnum-mismatch`) surface a `warn` and still want copy.
 * Per-id entries decide for themselves whether to emit on `warn`.
 */
export type FailingCheckStatus = 'fail' | 'warn';

/**
 * Function that turns a check's structured `details` into a list of
 * human-readable lines for the issues section. Receives the check
 * status so per-id entries can branch (e.g. artwork-rebuild only
 * elaborates on `fail`, not `warn`).
 *
 * Return `[]` if the check has nothing further to say at this status —
 * the renderer will just show the one-line summary from the check
 * itself.
 */
export type FailureCopyFn = (
  details: Record<string, unknown>,
  status: FailingCheckStatus
) => string[];

/**
 * Map from check id to its failure-copy builder. Checks not listed here
 * render with no extra detail lines (the check's own `summary` carries
 * the user-facing message).
 *
 * Adding copy for a new check: add an entry. No other change required.
 */
export const FAILURE_COPY: Readonly<Record<string, FailureCopyFn>> = {
  'artwork-rebuild': (details, status) => {
    if (status !== 'fail') return [];
    const lines: string[] = [];
    if (details.totalEntries !== undefined) {
      const total = (details.totalEntries as number).toLocaleString();
      const corrupt = (details.corruptEntries as number).toLocaleString();
      const healthyEntries = (details.healthyEntries as number).toLocaleString();
      const pct = details.corruptPercent;
      lines.push(
        `Corrupt: ${corrupt} / ${total} entries (${pct}%) reference data beyond ithmb file bounds`
      );
      lines.push(`Healthy: ${healthyEntries} entries with valid offsets`);
    }
    lines.push('The artwork database is out of sync with the thumbnail files.');
    lines.push('Affected tracks display wrong or missing artwork on the iPod.');
    return lines;
  },

  'sysinfo-consistency': (_details, status) => {
    if (status !== 'fail') return [];
    return [
      "The on-disk SysInfoExtended doesn't match the live device — likely a stale file copied from a different iPod.",
      'Run `podkit doctor --repair sysinfo-consistency` to refresh it from USB firmware.',
    ];
  },

  'sysinfo-modelnum-mismatch': () => {
    return [
      'The on-disk SysInfo file claims a different model than the firmware reports.',
      'This usually means SysInfo was manually edited or copied from another iPod.',
      'Run `podkit doctor --repair sysinfo-modelnum-mismatch` to refresh it from firmware.',
    ];
  },
};

/**
 * Look up and apply the failure copy for a check id. Returns `[]` when
 * no copy is registered for the id, or when the registered entry
 * decides this status doesn't warrant extra lines.
 */
export function formatFailureCopy(
  checkId: string,
  details: Record<string, unknown> | undefined,
  status: FailingCheckStatus
): string[] {
  const fn = FAILURE_COPY[checkId];
  if (!fn) return [];
  return fn(details ?? {}, status);
}
