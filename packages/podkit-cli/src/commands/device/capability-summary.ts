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
import type { ResolvedDeviceCapabilities } from '@podkit/device-types';
import { DOCS_URLS } from '@podkit/core';
import { CliError } from '../../errors.js';
import type { OutputContext } from '../../output/index.js';
import { formatResolved, formatValue } from '../../config/resolve.js';
import { DeviceErrorCodes } from './error-codes.js';

// =============================================================================
// printCapabilitySummary
// =============================================================================

export type CapabilityRenderContext =
  | {
      kind: 'ipod';
      /**
       * Generation label used in the `not supported on <model>` tail of
       * negative bullets. Callers compose it from the identity-cascade
       * model so it can never disagree with the model shown above it.
       */
      modelDisplay: string;
    }
  | { kind: 'mass-storage' };

export interface PrintCapabilitySummaryOptions {
  /** Outer indent for the section. Default `''`. */
  indent?: string;
  /**
   * Override the section header. Default `'Capabilities:'`. Callers pass a
   * richer string like `'Capabilities (from echo-mini preset)'` or
   * `'Capabilities (from iPod nano 3G)'` to anchor the section to the
   * derivation source.
   */
  sectionTitle?: string;
  /**
   * Mass-storage-only: unfiltered "device firmware can play" view. When this
   * is a strict superset of `capabilities.supportedAudioCodecs`, the renderer
   * shows both lists with the dropped codecs annotated as transcoded; when
   * the two lists are equal, the renderer collapses to a single `Audio Codecs:`
   * line. Ignored on the iPod variant.
   */
  firmwareCapabilities?: DeviceCapabilities;
  /**
   * Mass-storage-only: provenance-aware capabilities view. When supplied,
   * the renderer surfaces `[bracketed]` markers for fields inherited from
   * the preset and bare values for per-device overrides — matching the
   * `device list` vocabulary. When omitted, falls back to plain rendering
   * (no inheritance markers); used by `add-render` which doesn't have a
   * config-cascade view available at add time.
   */
  resolved?: ResolvedDeviceCapabilities;
}

/**
 * Codecs the firmware accepts but podkit will transcode before transfer
 * (the firmware ⊋ operational gap). Returns `[]` when firmware is absent or
 * when the operational list already covers every firmware codec.
 *
 * Shared between the `Audio Codecs:` sub-block render and the JSON
 * `firmwareSupportedAudioCodecs` gate in `info.ts` so the two surfaces
 * agree on what counts as a diff.
 */
export function getTranscodedCodecs(
  firmwareCodecs: readonly string[] | undefined,
  operationalCodecs: readonly string[]
): string[] {
  if (!firmwareCodecs) return [];
  return firmwareCodecs.filter((c) => !operationalCodecs.includes(c));
}

/**
 * Render a capability summary for a confirmed device.
 *
 * iPod variant: bullet list with `+`/`-` markers and "not supported on <gen>"
 * tail for negative bullets. Artwork bullet includes the max resolution when
 * known. Bullets cover only what `DeviceCapabilities` models — podcast
 * support is not among them.
 *
 * Mass-storage variant: tabular `Key: value` layout listing codecs, artwork
 * sources/resolution, video support, normalization mode, and album-artist
 * browsing. When `opts.firmwareCapabilities` carries a strict-superset codec
 * list (e.g. rockbox declares wav/aiff but the adapter drops them), the
 * `Audio Codecs:` line expands into a `Firmware:` / `Podkit:` sub-block.
 */
export function printCapabilitySummary(
  out: OutputContext,
  capabilities: DeviceCapabilities,
  ctx: CapabilityRenderContext,
  opts: PrintCapabilitySummaryOptions = {}
): void {
  const indent = opts.indent ?? '';
  const inner = `${indent}  `;
  out.print(`${indent}${opts.sectionTitle ?? 'Capabilities:'}`);

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
    return;
  }

  // mass-storage — tabular layout. When `opts.resolved` is supplied, every
  // boolean / value row is rendered through `formatResolved` so per-device
  // overrides surface as bare values and preset-inherited values surface as
  // `[bracketed]`. Without `opts.resolved` the renderer falls back to plain
  // values for backward compat (add-render call path; no cascade context).
  const r = opts.resolved;
  const operationalCodecs = capabilities.supportedAudioCodecs;
  const firmwareCodecs = opts.firmwareCapabilities?.supportedAudioCodecs;
  const transcoded = getTranscodedCodecs(firmwareCodecs, operationalCodecs);
  if (firmwareCodecs && transcoded.length > 0) {
    // Sub-block: firmware ⊋ operational. Show both views so users see what
    // their firmware can play AND what podkit will write — see
    // MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS in @podkit/devices-mass-storage.
    out.print(`${inner}Audio Codecs:`);
    out.print(`${inner}  Firmware:   ${firmwareCodecs.join(', ')}`);
    out.print(`${inner}  Podkit:     ${operationalCodecs.join(', ') || 'none'}`);
    out.print(`${inner}              (${transcoded.join(', ')} transcoded before transfer)`);
  } else {
    out.print(
      `${inner}Audio Codecs:    ${fmt(operationalCodecs.join(', '), r?.supportedAudioCodecs.source)}`
    );
  }
  const artworkSourcesStr = capabilities.artworkSources.join(', ') || 'none';
  const artworkSuffix = capabilities.artworkMaxResolution
    ? ` (max ${capabilities.artworkMaxResolution}px)`
    : '';
  out.print(
    `${inner}Artwork:         ${fmt(artworkSourcesStr, r?.artworkSources.source)}${artworkSuffix}`
  );
  out.print(`${inner}Video:           ${fmt(capabilities.supportsVideo, r?.supportsVideo.source)}`);
  out.print(
    `${inner}Normalization:   ${fmt(capabilities.audioNormalization, r?.audioNormalization.source)}`
  );
  out.print(
    `${inner}Album Artist:    ${fmt(capabilities.supportsAlbumArtistBrowsing, r?.supportsAlbumArtistBrowsing.source)}`
  );
}

/**
 * Render one capability value with vocabulary unified across the renderer.
 *
 * - When `source` is supplied (caller threaded `opts.resolved`), forward to
 *   `formatResolved` so per-field inheritance markers (`[bracketed]`) and
 *   unsupported / unknown symbols come from the shared helper.
 * - When `source` is absent (caller has no cascade context — e.g.
 *   `add-render` showing preset baselines before any device exists),
 *   short-circuit through `formatResolvedBareValue` so we still emit
 *   `on`/`off` for booleans without falsely tagging the value as a
 *   `'device-config'` override. Avoids semantic drift if a future caller
 *   passes a genuinely-inherited value with no source — they get plain
 *   rendering, not a false explicit-override marker.
 */
function fmt(value: unknown, source: string | undefined): string {
  if (source === undefined) return formatValue(value);
  return formatResolved({ value, source });
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
 * Wording is centralised: the canonical headline + docs URL are baked into
 * `IpodModel.unsupportedReason` by `@podkit/devices-ipod`'s cascade resolver.
 * No user-facing copy mentions `libgpod`.
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
  const reason = assessment?.model?.unsupportedReason;
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
 * still avoids mentioning `libgpod` (wording comes from the cascade resolver).
 */
export function assertAssessmentSupported(
  out: OutputContext,
  assessment: IpodIdentityAssessment | null | undefined
): void {
  const reason = assessment?.model?.unsupportedReason;
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
