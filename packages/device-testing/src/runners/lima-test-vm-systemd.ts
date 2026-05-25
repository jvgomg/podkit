/**
 * lima-test-vm-systemd — host→Lima-VM systemd unit installer for the VM
 * test VM.
 *
 * The VM runner (`lima-test-vm.ts`) starts and stops
 * `dummy-hcd-daemon@<persona>.service` between tests. systemd will refuse to
 * start that template unless the unit file is registered on disk at
 * `/etc/systemd/system/dummy-hcd-daemon@.service` and `systemctl daemon-reload`
 * has been run since the unit landed there. This module owns that install.
 *
 * Properties:
 *
 * - **Idempotent.** sha256-skips the copy + reload when the VM already has
 *   the right unit file, matching the binary-transfer helper.
 * - **daemon-reload on change.** Whenever the install runs, the helper also
 *   issues `sudo systemctl daemon-reload` so the next `systemctl start` sees
 *   the new bytes. A no-op skip does NOT reload.
 * - **Atomic.** Copies to `/tmp/dummy-hcd-daemon-<uuid>.service` then
 *   `sudo install -m 0644 <tmp> <vmUnitPath>`. Temp file is cleaned up,
 *   best-effort on failure.
 * - **DI seam.** Accepts a `SubprocessRunner` so unit tests can replay the
 *   `limactl` interactions without a real VM.
 *
 * @see adr/adr-016-linux-vm-test-harness.md
 * @see tools/device-testing/dummy-hcd/dummy-hcd-daemon@.service
 * @module
 */

import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultSubprocessRunner, type SubprocessRunner } from '../subprocess.js';
import { limactlError, runLimactl, shellQuote } from './lima-limactl.js';

/** Default destination inside the VM for the systemd unit template. */
export const DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH =
  '/etc/systemd/system/dummy-hcd-daemon@.service';

/** Options for {@link transferSystemdUnit}. */
export interface TransferSystemdUnitOpts {
  /** Lima instance name (e.g. `podkit-device-harness`). */
  vmName: string;
  /**
   * Absolute path to the host-side unit file. Defaults to the in-repo
   * `tools/device-testing/dummy-hcd/dummy-hcd-daemon@.service`.
   */
  hostUnitPath?: string;
  /**
   * Destination path inside the VM. Defaults to
   * `/etc/systemd/system/dummy-hcd-daemon@.service`.
   */
  vmUnitPath?: string;
  /**
   * Subprocess runner for `limactl` invocations. Production callers should
   * leave this unset; tests inject a scripted runner.
   */
  subprocess?: SubprocessRunner;
}

/** Outcome of a successful {@link transferSystemdUnit} invocation. */
export interface TransferSystemdUnitResult {
  /** Lima instance the unit was sent to. */
  vmName: string;
  /** Final destination path inside the VM. */
  vmUnitPath: string;
  /** sha256 hex digest of the host unit at the time of the call. */
  hostSha256: string;
  /** `true` when the VM already had a byte-identical unit. */
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
 * unit lives at `tools/device-testing/dummy-hcd/dummy-hcd-daemon@.service`,
 * relative to the repo root.
 *
 * This module sits at
 * `packages/device-testing/{src,dist}/runners/lima-test-vm-systemd.ts`, so
 * the repo root is four `..` segments up.
 */
export function resolveDefaultDummyHcdDaemonUnit(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const moduleDir = path.dirname(thisFile);
  const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
  return path.resolve(
    repoRoot,
    'tools',
    'device-testing',
    'dummy-hcd',
    'dummy-hcd-daemon@.service'
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Install the dummy-hcd-daemon systemd template into the test VM at
 * `vmUnitPath` (defaults to `/etc/systemd/system/dummy-hcd-daemon@.service`).
 *
 * Steps (mirrors `transferBinary`):
 *   1. Read the host file; compute sha256.
 *   2. Probe the VM for the existing sha256 at `vmUnitPath`. On match →
 *      return `{ skipped: true, reloaded: false }` with zero further calls.
 *   3. `limactl copy` to `/tmp/dummy-hcd-daemon-<uuid>.service`.
 *   4. `sudo install -m 0644 <tmp> <vmUnitPath>`.
 *   5. `sudo systemctl daemon-reload` so systemd picks up the new bytes.
 *   6. Best-effort `rm -f <tmp>`.
 *
 * Any non-zero `limactl` exit becomes a descriptive `Error` whose message
 * names which step failed.
 */
export async function transferSystemdUnit(
  opts: TransferSystemdUnitOpts
): Promise<TransferSystemdUnitResult> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const vmName = opts.vmName;
  const hostUnitPath = opts.hostUnitPath ?? resolveDefaultDummyHcdDaemonUnit();
  const vmUnitPath = opts.vmUnitPath ?? DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH;

  if (!vmName) {
    throw new Error('transferSystemdUnit: vmName is required.');
  }

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

  // 2. Idempotency: ask the VM for the sha256 of the existing unit file.
  //    Absent file → `sha256sum` exits non-zero, `awk` prints nothing — the
  //    `limactl shell` itself returns exit 0 with empty stdout. That is the
  //    normal "needs install" path, NOT an error.
  const probe = await runLimactl(subprocess, [
    'shell',
    vmName,
    '--',
    'sh',
    '-c',
    `sha256sum ${shellQuote(vmUnitPath)} 2>/dev/null | awk '{print $1}'`,
  ]);
  if (probe.exitCode !== 0) {
    throw limactlError(`failed to probe systemd unit at ${vmName}:${vmUnitPath}`, probe);
  }
  const vmSha256 = probe.stdout.trim();
  if (vmSha256 && vmSha256 === hostSha256) {
    return { vmName, vmUnitPath, hostSha256, skipped: true, reloaded: false };
  }

  // 3. Copy to a randomised temp path inside /tmp (tmpfs, no sudo).
  const tmpVmPath = `/tmp/dummy-hcd-daemon-${randomUUID()}.service`;
  const copyResult = await runLimactl(subprocess, ['copy', hostUnitPath, `${vmName}:${tmpVmPath}`]);
  if (copyResult.exitCode !== 0) {
    throw limactlError(
      `limactl copy failed sending systemd unit to ${vmName}:${tmpVmPath}`,
      copyResult
    );
  }

  // 4. Atomic install. `install -m 0644 <src> <dst>` writes to a temp file
  //    alongside `<dst>` and renames — a failure leaves `<dst>` untouched.
  const installResult = await runLimactl(subprocess, [
    'shell',
    vmName,
    '--',
    'sudo',
    'install',
    '-m',
    '0644',
    tmpVmPath,
    vmUnitPath,
  ]);
  if (installResult.exitCode !== 0) {
    await tryCleanup(subprocess, vmName, tmpVmPath);
    throw limactlError(
      `sudo install failed promoting ${tmpVmPath} → ${vmUnitPath} in ${vmName}`,
      installResult
    );
  }

  // 5. `systemctl daemon-reload` — without this, the next `systemctl start
  //    dummy-hcd-daemon@<id>` would see stale or absent unit metadata.
  const reloadResult = await runLimactl(subprocess, [
    'shell',
    vmName,
    '--',
    'sudo',
    'systemctl',
    'daemon-reload',
  ]);
  if (reloadResult.exitCode !== 0) {
    // The unit IS installed at this point — we just couldn't tell systemd
    // about it. Clean up the temp file but surface the reload failure so the
    // caller doesn't proceed to start a unit systemd will fail to load.
    await tryCleanup(subprocess, vmName, tmpVmPath);
    throw limactlError(`systemctl daemon-reload failed in ${vmName}`, reloadResult);
  }

  // 6. Cleanup the staging temp file. Best-effort: `/tmp` is tmpfs and
  //    will be wiped on reboot anyway.
  await tryCleanup(subprocess, vmName, tmpVmPath);

  return { vmName, vmUnitPath, hostSha256, skipped: false, reloaded: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tryCleanup(
  subprocess: SubprocessRunner,
  vmName: string,
  tmpVmPath: string
): Promise<void> {
  try {
    await subprocess.run('limactl', ['shell', vmName, '--', 'rm', '-f', tmpVmPath]);
  } catch {
    // Swallow — either we already returned the real error to the caller,
    // or the happy path finished and a leftover in /tmp is harmless.
  }
}
