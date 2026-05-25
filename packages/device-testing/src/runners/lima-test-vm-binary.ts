/**
 * lima-test-vm-binary — host→Lima-VM binary transfer for the VM test VM.
 *
 * The VM `podkit-device-harness` (see `tools/device-testing/lima/podkit-device-harness.yaml`)
 * deliberately has no source tree, no Bun, no Node, and no `mounts:` entry.
 * The compiled linux-x64/arm64 podkit binary produced by the builder VM is
 * the only podkit artefact that ever runs inside it. This module owns the
 * delivery mechanism that puts that binary at `/usr/local/bin/podkit`.
 *
 * Properties:
 *
 * - **Idempotent.** Hashes the host binary (sha256) and asks the VM for the
 *   sha256 of the file at `vmPath`. If they match, the transfer is skipped.
 * - **Atomic.** Copies to a randomised `/tmp/podkit-<uuid>` path inside the
 *   VM, then `sudo install -m 0755 <tmp> <vmPath>`. A partial transfer never
 *   leaves a broken binary at `vmPath`. The temp file is cleaned up
 *   afterwards (and on failure, best-effort).
 * - **Permissions.** `install -m 0755` sets the mode and ownership — no
 *   separate `chmod +x` step is required.
 * - **DI seam.** Accepts a `SubprocessRunner` so unit tests can replay
 *   `limactl` invocations without touching the host or a real VM. Production
 *   callers should leave the default in place.
 *
 * @see adr/adr-016-linux-vm-test-harness.md "Builder VM / test VM split"
 * @see tools/device-testing/lima/podkit-device-harness.yaml
 * @module
 */

import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { defaultSubprocessRunner, type SubprocessRunner } from '../subprocess.js';
import { limactlError, runLimactl, shellQuote } from './lima-limactl.js';

/** Default destination inside the VM for the podkit binary. */
export const DEFAULT_PODKIT_VM_PATH = '/usr/local/bin/podkit';
/** Default destination inside the VM for the gpod-tool helper. */
export const DEFAULT_GPOD_TOOL_VM_PATH = '/usr/local/bin/gpod-tool';

/** Options for {@link transferBinary} and {@link transferGpodTool}. */
export interface TransferBinaryOpts {
  /** Lima instance name (e.g. `podkit-device-harness`). */
  vmName: string;
  /** Absolute path to the host-side binary to transfer. */
  binaryPath: string;
  /**
   * Destination path inside the VM. Defaults to `/usr/local/bin/podkit`
   * for {@link transferBinary} and `/usr/local/bin/gpod-tool` for
   * {@link transferGpodTool}.
   */
  vmPath?: string;
  /**
   * Subprocess runner for `limactl` invocations. Production callers should
   * leave this unset (the default runs real `limactl`). Tests inject a
   * replay runner.
   */
  subprocess?: SubprocessRunner;
}

/** Outcome of a successful transfer attempt. */
export interface TransferBinaryResult {
  /** Lima instance the binary was sent to. */
  vmName: string;
  /** Final destination path inside the VM. */
  vmPath: string;
  /** sha256 hex digest of the host binary at the time of the call. */
  hostSha256: string;
  /**
   * `true` when the VM already had a binary with the same sha256 and the
   * copy/install steps were skipped. `false` for a fresh install.
   */
  skipped: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transfer the podkit linux binary from the host into a Lima VM and install
 * it atomically at `vmPath` (defaults to `/usr/local/bin/podkit`).
 *
 * Throws a descriptive `Error` on any non-zero `limactl` exit, missing host
 * binary, or transport-level failure.
 */
export async function transferBinary(opts: TransferBinaryOpts): Promise<TransferBinaryResult> {
  return transfer({
    ...opts,
    vmPath: opts.vmPath ?? DEFAULT_PODKIT_VM_PATH,
    label: 'podkit binary',
    missingHint:
      'Run `bunx turbo run @podkit/device-testing#build:linux-binary` ' +
      '(or `mise run device-testing:build-linux`) to produce one.',
  });
}

/**
 * Transfer the `gpod-tool` helper binary from the host into a Lima VM.
 *
 * If the source path does not exist on the host, throws an `Error` whose
 * message names the expected build step. This function deliberately does
 * NOT trigger a build — it is a transfer primitive, not a build orchestrator.
 */
export async function transferGpodTool(opts: TransferBinaryOpts): Promise<TransferBinaryResult> {
  return transfer({
    ...opts,
    vmPath: opts.vmPath ?? DEFAULT_GPOD_TOOL_VM_PATH,
    label: 'gpod-tool',
    missingHint:
      'Build a Linux gpod-tool first (host-side cross-build is not yet ' +
      'wired up — see tools/gpod-tool/Makefile and tools/device-testing/' +
      'lima/README.md §"gpod-tool sourcing"). Pass the resulting path via ' +
      '`binaryPath`.',
  });
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface InternalTransferOpts extends Omit<TransferBinaryOpts, 'vmPath'> {
  vmPath: string;
  label: string;
  missingHint: string;
}

async function transfer(opts: InternalTransferOpts): Promise<TransferBinaryResult> {
  const { vmName, binaryPath, vmPath, label, missingHint } = opts;
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;

  if (!vmName) {
    throw new Error('transferBinary: vmName is required.');
  }
  if (!binaryPath) {
    throw new Error('transferBinary: binaryPath is required.');
  }

  // 1. Verify host binary exists. Surface a clear error if not.
  let hostBytes: Buffer;
  try {
    hostBytes = fs.readFileSync(binaryPath);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `transferBinary: cannot read ${label} at ${binaryPath} (${cause}). ${missingHint}`
    );
  }
  const hostSha256 = createHash('sha256').update(hostBytes).digest('hex');

  // 2. Idempotency: ask the VM for the sha256 of the existing file. The
  //    fingerprint is the first 64 hex chars of `sha256sum`'s output. If
  //    the file is absent, `sha256sum` exits non-zero — that is the normal
  //    "needs install" path, not an error.
  const probe = await runLimactl(subprocess, [
    'shell',
    vmName,
    '--',
    'sh',
    '-c',
    `sha256sum ${shellQuote(vmPath)} 2>/dev/null | awk '{print $1}'`,
  ]);
  if (probe.exitCode !== 0) {
    // `limactl shell` itself failed (VM stopped, instance missing, etc.).
    throw limactlError(`failed to probe ${label} at ${vmName}:${vmPath}`, probe);
  }
  const vmSha256 = probe.stdout.trim();
  if (vmSha256 && vmSha256 === hostSha256) {
    return { vmName, vmPath, hostSha256, skipped: true };
  }

  // 3. Copy to a temp path inside the VM. `limactl copy` semantics:
  //    `limactl copy <host-path> <vm>:<vm-path>`.
  const tmpVmPath = `/tmp/podkit-transfer-${randomUUID()}`;
  const copyResult = await runLimactl(subprocess, ['copy', binaryPath, `${vmName}:${tmpVmPath}`]);
  if (copyResult.exitCode !== 0) {
    throw limactlError(
      `limactl copy failed sending ${label} to ${vmName}:${tmpVmPath}`,
      copyResult
    );
  }

  // 4. Atomic install. `install -m 0755 <src> <dst>` is atomic per POSIX:
  //    it writes to a temp file alongside dst then renames. A failure here
  //    leaves dst untouched.
  const installResult = await runLimactl(subprocess, [
    'shell',
    vmName,
    '--',
    'sudo',
    'install',
    '-m',
    '0755',
    tmpVmPath,
    vmPath,
  ]);
  if (installResult.exitCode !== 0) {
    // Best-effort cleanup of the temp file so a failed install does not
    // leave dangling state inside the VM.
    await tryCleanup(subprocess, vmName, tmpVmPath);
    throw limactlError(
      `sudo install failed promoting ${tmpVmPath} → ${vmPath} in ${vmName}`,
      installResult
    );
  }

  // 5. Cleanup the temp file. Non-fatal if it fails — the VM's `/tmp` is
  //    tmpfs and will be wiped on reboot.
  await tryCleanup(subprocess, vmName, tmpVmPath);

  return { vmName, vmPath, hostSha256, skipped: false };
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
    // Swallow — we already returned the real error to the caller, or the
    // happy path finished and a leftover in /tmp is harmless.
  }
}
