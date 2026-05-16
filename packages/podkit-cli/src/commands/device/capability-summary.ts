/**
 * Unified capability-summary renderer for the `podkit device` family.
 *
 * Dispatches on `ctx.kind` so both device families can be rendered through one
 * entry point. The iPod variant uses the bullet style (carries a "not supported
 * on <gen>" tail on negative bullets); the mass-storage variant uses a tabular
 * "Audio Codecs: ... Artwork: ..." layout.
 *
 * Also hosts `confirmUnsupportedDeviceAdd`, the prompt-style gate used by
 * `add.ts` to surface the canonical message for known-unsupported iPod
 * generations and offer the user an explicit "Add anyway?" choice
 * (TASK-317.03 warn-allow flow). The legacy `assertAssessmentSupported`
 * remains as a thin compat shim for transitional callers.
 *
 * @module
 */

import type { DeviceCapabilities, IpodIdentityAssessment } from '@podkit/core';
import { DOCS_URLS, makeUnsupportedReasonFromAssessment } from '@podkit/core';
import { CliError } from '../../errors.js';
import type { OutputContext } from '../../output/index.js';
import { DeviceErrorCodes } from './error-codes.js';

// =============================================================================
// printCapabilitySummary
// =============================================================================

export type CapabilityRenderContext =
  | {
      kind: 'ipod';
      modelDisplay: string;
      /**
       * When set, append a `Podcasts` bullet after `Video`. The canonical
       * `DeviceCapabilities` does not model podcast support separately
       * (it derives from artwork support per generation table), so
       * `add.ts` leaves it unset. The `device info` flow has access to
       * the libgpod-side `supportsPodcast` flag and passes it through to
       * preserve its existing UX.
       */
      supportsPodcast?: boolean;
    }
  | { kind: 'mass-storage' };

export interface PrintCapabilitySummaryOptions {
  /** Outer indent for the "Capabilities:" header. Default `''`. */
  indent?: string;
}

/**
 * Render a capability summary for a confirmed device.
 *
 * iPod variant: bullet list with `+`/`-` markers and "not supported on <gen>"
 * tail for negative bullets. Artwork bullet includes the max resolution when
 * known.
 *
 * Mass-storage variant: tabular `Key: value` layout listing codecs, artwork
 * sources/resolution, video support, normalization mode, and album-artist
 * browsing.
 */
export function printCapabilitySummary(
  out: OutputContext,
  capabilities: DeviceCapabilities,
  ctx: CapabilityRenderContext,
  opts: PrintCapabilitySummaryOptions = {}
): void {
  const indent = opts.indent ?? '';
  const inner = `${indent}  `;
  out.print(`${indent}Capabilities:`);

  if (ctx.kind === 'ipod') {
    out.print(`${inner}+ Music`);
    if (capabilities.artworkSources.length > 0 && capabilities.artworkMaxResolution) {
      out.print(`${inner}+ Artwork (max ${capabilities.artworkMaxResolution}px)`);
    } else {
      out.print(`${inner}- Artwork (not supported on ${ctx.modelDisplay})`);
    }
    if (capabilities.supportsVideo) {
      out.print(`${inner}+ Video`);
    } else {
      out.print(`${inner}- Video (not supported on ${ctx.modelDisplay})`);
    }
    // Podcast support is not modelled in DeviceCapabilities (derives from
    // artwork support per the generation table) — render only when the
    // caller passes the legacy libgpod flag through `ctx.supportsPodcast`.
    if (ctx.supportsPodcast !== undefined) {
      if (ctx.supportsPodcast) {
        out.print(`${inner}+ Podcasts`);
      } else {
        out.print(`${inner}- Podcasts (not supported on ${ctx.modelDisplay})`);
      }
    }
    return;
  }

  // mass-storage — tabular layout
  out.print(`${inner}Audio Codecs:    ${capabilities.supportedAudioCodecs.join(', ')}`);
  out.print(
    `${inner}Artwork:         ${capabilities.artworkSources.join(', ')} (max ${capabilities.artworkMaxResolution}px)`
  );
  out.print(`${inner}Video:           ${capabilities.supportsVideo ? 'yes' : 'no'}`);
  out.print(`${inner}Normalization:   ${capabilities.audioNormalization}`);
  out.print(`${inner}Album Artist:    ${capabilities.supportsAlbumArtistBrowsing ? 'yes' : 'no'}`);
}

// =============================================================================
// confirmUnsupportedDeviceAdd  (TASK-317.03 — warn-allow flow)
// =============================================================================

/**
 * Result of {@link confirmUnsupportedDeviceAdd}.
 *
 * - `'supported'`: the assessment resolves to a supported model. Caller
 *   continues the normal add flow.
 * - `'add-anyway'`: the device is unsupported, the user confirmed they want
 *   to add it anyway. Caller should persist with `unsupported: true`.
 * - `'cancelled'`: the device is unsupported and the user declined. Caller
 *   should print a "Cancelled." message and return without writing config.
 */
export type UnsupportedAddDecision = 'supported' | 'add-anyway' | 'cancelled';

/**
 * Prompt-style gate for the cascade-derived "device is unsupported" signal.
 *
 * Replaces the previous throw-style `assertAssessmentSupported` (TASK-317.03):
 * `podkit device add` now warns and offers to proceed instead of hard-refusing.
 * On confirmation the caller writes `unsupported: true` in the device config so
 * future runs (`sync`, mutating `doctor` repairs) can still refuse.
 *
 * Wording is centralised: the canonical headline + docs URL come from the
 * `@podkit/core` bridge function. No user-facing copy mentions `libgpod`.
 *
 * Behaviour:
 * - Supported device → returns `'supported'` immediately (no prompt).
 * - JSON mode → still prompts via the injected `confirmFn` (callers wire
 *   `autoConfirm` from `--yes`); in JSON mode without `--yes` the conventional
 *   choice is to default to N (decline). Tests pass `confirmFn` explicitly.
 * - `autoConfirm` (`--yes`) → defaults to ACCEPT (`'add-anyway'`) without
 *   reading from stdin, matching the brief.
 */
export async function confirmUnsupportedDeviceAdd(
  out: OutputContext,
  assessment: IpodIdentityAssessment | null | undefined,
  opts: {
    autoConfirm: boolean;
    confirmFn: (msg: string) => Promise<boolean>;
  }
): Promise<UnsupportedAddDecision> {
  const reason = makeUnsupportedReasonFromAssessment(assessment);
  if (!reason) return 'supported';

  // Render canonical message regardless of text/JSON mode — text consumers
  // get the friendly block, JSON consumers can scrape the same lines from
  // stderr (this is informational; the structured payload also goes onto
  // the device-add JSON output via the persisted `unsupported: true` flag).
  if (out.isText) {
    out.newline();
    out.warn(reason.headline);
    if (reason.details) {
      for (const line of reason.details) {
        out.print(`  ${line}`);
      }
    }
    out.print(`  See: ${reason.docsUrl ?? DOCS_URLS.supportedDevices}`);
    out.newline();
  }

  // `--yes` flips the default to accept. Otherwise prompt with default N.
  if (opts.autoConfirm) return 'add-anyway';

  const accepted = await opts.confirmFn('Add anyway? [y/N]');
  return accepted ? 'add-anyway' : 'cancelled';
}

// =============================================================================
// LEGACY assertAssessmentSupported — kept as a thin compat shim
// =============================================================================

/**
 * @deprecated Use {@link confirmUnsupportedDeviceAdd} instead. This helper
 * exists only so transitional call sites can keep compiling while they
 * migrate to the warn-allow flow.
 *
 * Still throws `UNSUPPORTED_DEVICE` if the assessment carries a refusal;
 * still avoids mentioning `libgpod` (wording comes from the bridge).
 */
export function assertAssessmentSupported(
  out: OutputContext,
  assessment: IpodIdentityAssessment | null | undefined
): void {
  const reason = makeUnsupportedReasonFromAssessment(assessment);
  if (!reason) return;

  if (out.isText) {
    out.newline();
    out.error(`Error: ${reason.headline}`);
    out.print(`  See: ${reason.docsUrl ?? DOCS_URLS.supportedDevices}`);
  }
  throw new CliError({
    message: reason.headline,
    code: DeviceErrorCodes.UNSUPPORTED_DEVICE,
    details: {
      generation: assessment?.model?.generationId,
      unsupported: reason,
    },
  });
}
