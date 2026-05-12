/**
 * Unified capability-summary renderer for the `podkit device` family.
 *
 * Dispatches on `ctx.kind` so both device families can be rendered through one
 * entry point. The iPod variant uses the bullet style (carries a "not supported
 * on <gen>" tail on negative bullets); the mass-storage variant uses a tabular
 * "Audio Codecs: ... Artwork: ..." layout.
 *
 * Also hosts `assertAssessmentSupported`, the throw helper used by `add.ts` to
 * reject known-unsupported iPod generations early.
 *
 * @module
 */

import type { DeviceCapabilities, IpodIdentityAssessment } from '@podkit/core';
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
// assertAssessmentSupported
// =============================================================================

/**
 * Throw `UNSUPPORTED_DEVICE` if the cascade-derived assessment carries
 * `notSupportedReason`.
 *
 * The cascade resolver attaches `notSupportedReason` for generations podkit
 * does not support (touch_*, nano_6, shuffle_3g/4g). Both add-flow paths
 * (`--path` and `--device`) gate on this; this helper hosts the shared
 * error-shape and the docs link.
 */
export function assertAssessmentSupported(
  out: OutputContext,
  assessment: IpodIdentityAssessment | null | undefined
): void {
  if (!assessment?.model?.notSupportedReason) return;

  const message = assessment.model.notSupportedReason;
  if (out.isText) {
    out.newline();
    out.error(`Error: ${message}`);
    out.print('  See: https://jvgomg.github.io/podkit/devices/supported-devices');
  }
  throw new CliError({
    message,
    code: DeviceErrorCodes.UNSUPPORTED_DEVICE,
    details: { generation: assessment.model.generationId },
  });
}
