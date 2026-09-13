/**
 * Host→substrate systemd unit installer for the device harness.
 *
 * The harness runtime (`lima-test-vm.ts`) starts and stops
 * `dummy-hcd-daemon@<persona>.service` between tests. systemd will refuse to
 * start that template unless the unit file is registered on disk at
 * `/etc/systemd/system/dummy-hcd-daemon@.service` and `systemctl daemon-reload`
 * has been run since the unit landed there. This module owns that install.
 *
 * Properties:
 *
 * - **Idempotent.** sha256-skips the copy + reload when the substrate already
 *   has the right unit file, matching the binary-transfer helper.
 * - **daemon-reload on change.** Whenever the install runs, the helper also
 *   issues `sudo systemctl daemon-reload` so the next `systemctl start` sees
 *   the new bytes. A no-op skip does NOT reload.
 * - **Atomic.** Stages to `/tmp/dummy-hcd-daemon-<uuid>.service` then
 *   `sudo install -m 0644 <tmp> <vmUnitPath>`; see `./substrate-install.ts`.
 * - **DI seam.** Takes a `SubstrateLink`, so unit tests replay the link's
 *   invocations without a real substrate.
 *
 * @see docs/adr/adr-016-linux-vm-test-harness.md
 * @see docs/adr/adr-028-substrate-agnostic-device-harness.md
 * @see test-packages/device-testing-daemon/dummy-hcd-daemon@.service
 * @module
 */

import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { guestCommandError, shellQuote, type SubstrateLink } from '@podkit/substrate';

import { deviceSubstrateLink } from './substrate.js';
import { installIntoSubstrate } from './substrate-install.js';
import { repoRoot } from './paths.js';

/** Default destination inside the substrate for the systemd unit template. */
export const DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH =
  '/etc/systemd/system/dummy-hcd-daemon@.service';

/** Options for {@link transferSystemdUnit}. */
export interface TransferSystemdUnitOpts {
  /**
   * Link to the substrate the unit is going to. Defaults to the selected
   * device substrate; tests inject a link over a scripted runner.
   */
  link?: SubstrateLink;
  /**
   * Absolute path to the host-side unit file. Defaults to the in-repo
   * `test-packages/device-testing-daemon/dummy-hcd-daemon@.service`.
   */
  hostUnitPath?: string;
  /**
   * Destination path inside the substrate. Defaults to
   * `/etc/systemd/system/dummy-hcd-daemon@.service`.
   */
  vmUnitPath?: string;
}

/** Outcome of a successful {@link transferSystemdUnit} invocation. */
export interface TransferSystemdUnitResult {
  /** The substrate the unit was sent to, as the link describes itself. */
  substrate: string;
  /** Final destination path inside the substrate. */
  vmUnitPath: string;
  /** sha256 hex digest of the host unit at the time of the call. */
  hostSha256: string;
  /** `true` when the substrate already had a byte-identical unit. */
  skipped: boolean;
  /**
   * `true` when `sudo systemctl daemon-reload` was invoked. Only happens on
   * a real install — a sha256-match skip leaves systemd's view untouched.
   */
  reloaded: boolean;
}

// ---------------------------------------------------------------------------
// Default host path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the default host path to the dummy-hcd-daemon systemd unit. The
 * unit lives at `test-packages/device-testing-daemon/dummy-hcd-daemon@.service`,
 * relative to the repo root.
 *
 * This module sits at
 * `test-packages/device-testing/{src,dist}/runners/lima-test-vm-systemd.ts`, so
 * the repo root is four `..` segments up.
 */
export function resolveDefaultDummyHcdDaemonUnit(): string {
  return path.resolve(
    repoRoot(),
    'test-packages',
    'device-testing-daemon',
    'dummy-hcd-daemon@.service'
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Install the dummy-hcd-daemon systemd template into the substrate at
 * `vmUnitPath` (defaults to `/etc/systemd/system/dummy-hcd-daemon@.service`).
 *
 * Steps (mirrors `transferBinary`):
 *   1. Read the host file; compute sha256.
 *   2. Probe the substrate for the existing sha256 at `vmUnitPath`. On match →
 *      return `{ skipped: true, reloaded: false }` with zero further calls.
 *   3. Copy to `/tmp/dummy-hcd-daemon-<uuid>.service`.
 *   4. `sudo install -m 0644 <tmp> <vmUnitPath>`.
 *   5. `sudo systemctl daemon-reload` so systemd picks up the new bytes.
 *   6. Best-effort `rm -f <tmp>`.
 *
 * A guest step that fails becomes a descriptive `Error` whose message names
 * which step it was; a substrate that could not be reached at all throws
 * `SubstrateLinkError` instead, so a caller can tell "skip" from "fail".
 */
export async function transferSystemdUnit(
  opts: TransferSystemdUnitOpts
): Promise<TransferSystemdUnitResult> {
  const link = opts.link ?? deviceSubstrateLink();
  const hostUnitPath = opts.hostUnitPath ?? resolveDefaultDummyHcdDaemonUnit();
  const vmUnitPath = opts.vmUnitPath ?? DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH;

  // 1. Verify host unit file exists. Surface a clear error if not — the
  //    unit ships with the repo, so absence almost always means a stale
  //    checkout or a renamed file. Name the expected path so the operator
  //    can spot the typo.
  let hostBytes: Buffer;
  try {
    hostBytes = fs.readFileSync(hostUnitPath);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `transferSystemdUnit: cannot read systemd unit file (expected at ${hostUnitPath}): ${cause}`
    );
  }
  const hostSha256 = createHash('sha256').update(hostBytes).digest('hex');

  // 2. Idempotency: ask the substrate for the sha256 of the existing unit
  //    file. Absent file → `sha256sum` exits non-zero, `awk` prints nothing —
  //    but the pipeline's exit code is `awk`'s, so the GUEST returns 0 with
  //    empty stdout. That is the normal "needs install" path, NOT an error.
  const probe = await link.exec([
    'sh',
    '-c',
    `sha256sum ${shellQuote(vmUnitPath)} 2>/dev/null | awk '{print $1}'`,
  ]);
  if (probe.exitCode !== 0) {
    // The substrate answered and the probe pipeline itself failed. An
    // unreachable substrate cannot reach this branch — `exec` throws
    // `SubstrateLinkError` for that — which is what lets this message name a
    // guest-side fault rather than listing every possible cause.
    throw guestCommandError(
      `failed to probe systemd unit at ${link.description}:${vmUnitPath}`,
      probe
    );
  }
  const vmSha256 = probe.stdout.trim();
  if (vmSha256 && vmSha256 === hostSha256) {
    return { substrate: link.description, vmUnitPath, hostSha256, skipped: true, reloaded: false };
  }

  // 3–4. Stage in /tmp, then atomically install into place.
  const tmpVmPath = `/tmp/dummy-hcd-daemon-${randomUUID()}.service`;
  await installIntoSubstrate({
    link,
    hostPath: hostUnitPath,
    guestPath: vmUnitPath,
    stagePath: tmpVmPath,
    mode: '0644',
    label: 'systemd unit',
  });

  // 5. `systemctl daemon-reload` — without this, the next `systemctl start
  //    dummy-hcd-daemon@<id>` would see stale or absent unit metadata.
  const reloadResult = await link.exec(['sudo', 'systemctl', 'daemon-reload']);
  if (reloadResult.exitCode !== 0) {
    // The unit IS installed at this point — we just couldn't tell systemd
    // about it. Surface the reload failure so the caller doesn't proceed to
    // start a unit systemd will fail to load.
    throw guestCommandError(`systemctl daemon-reload failed in ${link.description}`, reloadResult);
  }

  return { substrate: link.description, vmUnitPath, hostSha256, skipped: false, reloaded: true };
}
