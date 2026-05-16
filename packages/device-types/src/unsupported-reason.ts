/**
 * Canonical "this device is unsupported" payload.
 *
 * Lives in `@podkit/device-types` so every layer of the podkit stack —
 * from `@podkit/devices-ipod` (which produces it when a generation is in
 * the unsupported table) through `@podkit/core`'s readiness pipeline and
 * the CLI's renderers — can speak the same shape without a bridge function.
 *
 * The `kind` discriminator drives rendering branches (filesystem policy,
 * unsupported model, missing preset, iOS device). `headline` is the
 * single-line message shown first; `details` carries optional indented
 * follow-up lines; `docsUrl` links to the policy page; `filesystem` /
 * `path` are populated only for the filesystem-policy variant.
 *
 * @module
 */

/**
 * Structured payload describing why a device is rejected. Carries
 * machine-readable fields so JSON consumers can render rich diagnostics
 * and the CLI can emit a multi-line message without parsing strings.
 *
 * The `kind` discriminator lets renderers branch on rejection class
 * (filesystem policy, unsupported model, missing preset, iOS device)
 * while keeping the payload extension-friendly.
 */
export interface ReadinessUnsupportedReason {
  /** Rejection class. New variants can be added as podkit grows policies. */
  kind:
    | 'filesystem-unsupported-on-linux'
    | 'unsupported-device'
    | 'unsupported-preset'
    | 'ios-device';
  /** Single-line headline shown first (e.g. "Filesystem not supported on Linux"). */
  headline: string;
  /** Optional indented detail lines rendered under the headline. */
  details?: string[];
  /** Optional documentation link the user can follow. */
  docsUrl?: string;
  /** Filesystem string (when kind === 'filesystem-unsupported-on-linux'). */
  filesystem?: string;
  /** Mount path (when kind === 'filesystem-unsupported-on-linux'). */
  path?: string;
}
