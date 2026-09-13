/**
 * Put a host file at a root-owned path inside a substrate.
 *
 * Five helpers in this package used to spell out the same three steps — copy
 * to a randomised `/tmp` path, `sudo install` it into place, best-effort remove
 * the staging copy — with five sets of near-identical error strings and five
 * chances to forget the cleanup on the failure branch. This is that sequence,
 * once.
 *
 * ## Why the /tmp hop is not optional
 *
 * Both links copy as the unprivileged guest user, so a direct write under
 * `/usr/local`, `/etc` or `/var` is refused. `install(1)` is what promotes the
 * file: it is atomic (writes beside the destination, then renames, so a failure
 * never leaves a half-written binary at a path something is about to execute)
 * and it sets the mode in the same call, which a `cp` + `chmod` pair does not.
 *
 * ## Why there is no stdin path
 *
 * Callers that hold BYTES rather than a file — the persona sidecar, the sealed
 * baseline hash — write a host temp file first and come through here. Piping
 * them to a guest-side `tee` would be shorter and would half-work: `limactl
 * shell` does not reliably forward stdin, so the two links would behave
 * differently at exactly the layer that exists to make them behave the same.
 * See the note on `SubstrateLink` in `@podkit/substrate`.
 *
 * @module
 */

import { guestCommandError, isSubstrateLinkError, type SubstrateLink } from '@podkit/substrate';

import { SUBSTRATE_ROUND_TRIP_TIMEOUT_MS } from './substrate.js';

/** Options for {@link installIntoSubstrate}. */
export interface InstallIntoSubstrateOpts {
  /** Link to the substrate the file is going to. */
  link: SubstrateLink;
  /** Absolute host path of the file to send. */
  hostPath: string;
  /** Absolute guest path the file ends up at. */
  guestPath: string;
  /**
   * Guest staging path, under `/tmp`. Supplied by the caller rather than
   * generated here because each caller's name is what a human debugging a
   * leftover staging file has to recognise.
   */
  stagePath: string;
  /** Mode passed to `install -m`, e.g. `0755`. */
  mode: string;
  /**
   * Pass `install -D` so the destination's parent directories are created.
   * Off by default: `-D` on a path whose parent should already exist hides a
   * substrate that was never provisioned.
   */
  createParents?: boolean;
  /**
   * Noun used in error messages — "podkit binary", "systemd unit". It is the
   * only thing distinguishing one failed install from another in a log.
   */
  label: string;
  /**
   * Bound for the host→guest copy. Defaults to unbounded.
   *
   * Separate from {@link installTimeoutMs} because the two steps are bounded
   * for different reasons: a copy's duration is set by the payload crossing a
   * link, while an `install` is a substrate-local file operation. Collapsing
   * them to one number means the looser of the two silently becomes the bound
   * on both, which is most of the way back to having no bound.
   */
  copyTimeoutMs?: number;
  /**
   * Bound for the `sudo install`. The staging-file sweep is NOT covered by it:
   * an `rm -f` is a syscall whatever the payload, so it takes the flat
   * {@link SUBSTRATE_ROUND_TRIP_TIMEOUT_MS} and an image-sized bound never
   * leaks onto it.
   */
  installTimeoutMs?: number;
}

/**
 * Copy `hostPath` into the substrate and install it at `guestPath` as root.
 *
 * @throws {SubstrateLinkError} when the substrate could not be reached.
 * @throws {Error} with the guest's own output when the copy or the install
 * failed on a substrate that was answering.
 */
export async function installIntoSubstrate(opts: InstallIntoSubstrateOpts): Promise<void> {
  const { link, hostPath, guestPath, stagePath, mode, label } = opts;
  const copyBound = typeof opts.copyTimeoutMs === 'number' ? { timeoutMs: opts.copyTimeoutMs } : {};
  const bound =
    typeof opts.installTimeoutMs === 'number' ? { timeoutMs: opts.installTimeoutMs } : {};

  try {
    await link.copyIn(hostPath, stagePath, copyBound);
  } catch (err) {
    // A link failure passes through UNWRAPPED. It is the one error whose type
    // callers branch on ("skip, the substrate is gone" vs "fail"), and wrapping
    // it in a plain `Error` to add a label would trade that distinction for a
    // nicer sentence. Everything else gets the label, because "failed to copy"
    // with no noun is the log line nobody can act on.
    if (isSubstrateLinkError(err)) throw err;
    throw new Error(
      `failed to copy ${label} to ${link.description}:${stagePath}: ` +
        (err instanceof Error ? err.message : String(err)),
      { cause: err }
    );
  }

  const flags = opts.createParents ? ['-D', '-m', mode] : ['-m', mode];
  const install = await link.exec(['sudo', 'install', ...flags, stagePath, guestPath], bound);
  if (install.exitCode !== 0) {
    await removeStagedFile(link, stagePath);
    throw guestCommandError(
      `sudo install failed promoting ${stagePath} → ${guestPath} in ${link.description}`,
      install
    );
  }

  await removeStagedFile(link, stagePath);
}

/**
 * Best-effort removal of a staging file.
 *
 * Deliberately swallows everything: on the failure path the real error is
 * already on its way to the caller, and on the happy path a leftover in a
 * tmpfs `/tmp` is wiped by the next reboot. Turning either into a second,
 * less-informative error would be strictly worse.
 */
async function removeStagedFile(link: SubstrateLink, stagePath: string): Promise<void> {
  try {
    await link.exec(['rm', '-f', stagePath], { timeoutMs: SUBSTRATE_ROUND_TRIP_TIMEOUT_MS });
  } catch {
    // See above.
  }
}
