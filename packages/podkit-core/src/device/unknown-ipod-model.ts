/**
 * Unknown-iPod-model sync guard.
 *
 * When an iPod's model cannot be resolved from its on-disk identity, podkit
 * used to fall back to a "generic iPod" and sync anyway — risking the wrong
 * artwork format or an incompatible database, silently. This module replaces
 * that silent degradation with a hard, typed error carrying actionable
 * remediation.
 *
 * The decision is a pure function over the resolution result so it is
 * table-testable without a device: feed it the `IpodModel | null` returned by
 * `resolveIpodModel` plus the inputs that produced it, and it either returns
 * the model or throws {@link UnknownIpodModelError}.
 *
 * @module
 */

import type { IpodModel, ResolveModelInput } from '@podkit/devices-ipod';

/**
 * The model could not be resolved from on-disk identity.
 *
 * Carries the {@link ResolveModelInput} that failed to resolve so callers can
 * surface diagnostics, and a remediation message steering the user at the
 * one-time USB setup (`device add` with USB passthrough) or the in-place repair
 * (`doctor --repair sysinfo-extended`). Both write the authoritative identity
 * file the resolver reads, after which sync needs no USB.
 *
 * Wording stays neutral — no implementation (libgpod) leakage in user-facing
 * copy, matching the rest of the device-identity surface.
 */
export class UnknownIpodModelError extends Error {
  override readonly name = 'UnknownIpodModelError';
  readonly code = 'UNKNOWN_IPOD_MODEL' as const;

  constructor(readonly identity: ResolveModelInput) {
    super(
      'Could not identify this iPod model from its on-disk identity. ' +
        'podkit refuses to sync an unidentified iPod because it cannot choose the ' +
        'correct artwork format or database layout, which can corrupt the device.\n' +
        'Set the iPod up once so its identity is written to disk:\n' +
        '  - Run `podkit device add` with the iPod connected over USB ' +
        '(in Docker, pass the USB device through once), or\n' +
        '  - Run `podkit doctor --repair sysinfo-extended` to write the identity ' +
        'from firmware.\n' +
        'After setup, later syncs need only the mounted volume — no USB.'
    );
  }
}

/**
 * Return `model` if resolution succeeded, otherwise throw
 * {@link UnknownIpodModelError}.
 *
 * @param model    - Result of `resolveIpodModel` (or any model lookup).
 * @param identity - The resolution inputs, carried on the error for diagnostics.
 */
export function assertKnownIpodModel(
  model: IpodModel | null,
  identity: ResolveModelInput
): IpodModel {
  if (model) return model;
  throw new UnknownIpodModelError(identity);
}
