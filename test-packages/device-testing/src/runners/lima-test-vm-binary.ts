/**
 * Host→substrate binary transfer for the device harness.
 *
 * The substrate (see `test-packages/lima/vms/podkit-device.yaml` for the Lima
 * recipe, `scripts/substrate-contract.sh` for what any substrate must satisfy)
 * deliberately has no source tree, no Bun, no Node, and no host mount. The
 * compiled linux-x64/arm64 podkit binary is the only podkit artefact that ever
 * runs inside it. This module owns the delivery mechanism that puts that binary
 * at `/usr/local/bin/podkit`.
 *
 * Properties:
 *
 * - **Idempotent.** Hashes the host binary (sha256) and asks the substrate for
 *   the sha256 of the file at `vmPath`. If they match, the transfer is skipped.
 * - **Architecture-checked.** The same probe asks the substrate what machine it
 *   is, and the artifact's ELF header has to agree before anything is copied.
 *   This is the backstop for a wrong build-cache key (see `targetArch()` in
 *   `@podkit/substrate`): a foreign-arch binary installs perfectly happily and
 *   then fails with `exec format error` partway through a test run, attributed
 *   to whichever test invoked it first.
 * - **Atomic.** Stages to a randomised `/tmp/podkit-<uuid>` path, then
 *   `sudo install -m 0755`. A partial transfer never leaves a broken binary at
 *   `vmPath`. See `./substrate-install.ts`.
 * - **Permissions.** `install -m 0755` sets the mode and ownership — no
 *   separate `chmod +x` step is required.
 * - **DI seam.** Takes a `SubstrateLink`, so unit tests replay the link's
 *   invocations without touching the host or a real substrate, and so the same
 *   code reaches a Lima VM or an SSH-reachable box. Production callers leave it
 *   unset and get the selected substrate.
 *
 * @see docs/adr/adr-016-linux-vm-test-harness.md "Builder VM / test VM split"
 * @see docs/adr/adr-028-substrate-agnostic-device-harness.md
 * @module
 */

import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';

import {
  assertArtifactArch,
  guestCommandError,
  shellQuote,
  type SubstrateLink,
} from '@podkit/substrate';

import { deviceSubstrateLink } from './substrate.js';
import { installIntoSubstrate } from './substrate-install.js';

/** Default destination inside the substrate for the podkit binary. */
export const DEFAULT_PODKIT_VM_PATH = '/usr/local/bin/podkit';
/**
 * Default destination inside the substrate for the podkit-debug binary
 * (`__PODKIT_DEV_HOOKS__=true`, hooks active). E2E tests that need to
 * pause podkit mid-flight (e.g. for SIGKILL round-trip coverage) invoke
 * this path explicitly via the e2e cli runner's `binary: 'debug'`
 * option. See `docs/architecture/dev-builds.md`.
 */
export const DEFAULT_PODKIT_DEBUG_VM_PATH = '/usr/local/bin/podkit-debug';
/** Default destination inside the substrate for the gpod-tool helper. */
export const DEFAULT_GPOD_TOOL_VM_PATH = '/usr/local/bin/gpod-tool';

/** Options for {@link transferBinary} and {@link transferGpodTool}. */
export interface TransferBinaryOpts {
  /**
   * Link to the substrate the binary is going to. Defaults to the selected
   * device substrate; tests inject a link over a scripted runner.
   */
  link?: SubstrateLink;
  /** Absolute path to the host-side binary to transfer. */
  binaryPath: string;
  /**
   * Destination path inside the substrate. Defaults to `/usr/local/bin/podkit`
   * for {@link transferBinary} and `/usr/local/bin/gpod-tool` for
   * {@link transferGpodTool}.
   */
  vmPath?: string;
}

/** Outcome of a successful transfer attempt. */
export interface TransferBinaryResult {
  /** The substrate the binary was sent to, as the link describes itself. */
  substrate: string;
  /** Final destination path inside the substrate. */
  vmPath: string;
  /** sha256 hex digest of the host binary at the time of the call. */
  hostSha256: string;
  /**
   * `true` when the substrate already had a binary with the same sha256 and
   * the copy/install steps were skipped. `false` for a fresh install.
   */
  skipped: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transfer the podkit linux binary from the host into the substrate and
 * install it atomically at `vmPath` (defaults to `/usr/local/bin/podkit`).
 *
 * Throws a descriptive `Error` on a missing host binary or a failed guest step,
 * and a `SubstrateLinkError` when the substrate itself could not be reached.
 */
export async function transferBinary(opts: TransferBinaryOpts): Promise<TransferBinaryResult> {
  return transfer({
    ...opts,
    vmPath: opts.vmPath ?? DEFAULT_PODKIT_VM_PATH,
    label: 'podkit binary',
    missingHint:
      'Run `bun run harness:install` to build + transfer one ' +
      '(or `bunx turbo run @podkit/device-testing#build:linux-binary` for the build alone).',
  });
}

/**
 * Transfer the `gpod-tool` helper binary from the host into the substrate.
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
      'Run `bun run harness:install` to build + transfer a Linux gpod-tool ' +
      '(or `bunx turbo run @podkit/gpod-testing#build:linux-binary` for the ' +
      'build alone).',
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
  const { binaryPath, vmPath, label, missingHint } = opts;
  const link = opts.link ?? deviceSubstrateLink();

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

  // 2. One probe, two facts. The transfer decision needs both what machine the
  //    substrate is and the digest of whatever already sits at `vmPath`, and
  //    they are asked for together rather than in two round trips — `uname -m`
  //    on the first line, the digest (possibly empty) on the second.
  //
  //    The fingerprint is the first 64 hex chars of `sha256sum`'s output. If
  //    the file is absent, `sha256sum` exits non-zero — but the `sh -c`
  //    pipeline ends in `awk`, so the GUEST still exits 0 with empty stdout.
  //    That is the normal "needs install" path, not an error.
  const probe = await link.exec([
    'sh',
    '-c',
    `uname -m; sha256sum ${shellQuote(vmPath)} 2>/dev/null | awk '{print $1}'`,
  ]);
  if (probe.exitCode !== 0) {
    // Reaching here means the substrate answered and the probe pipeline itself
    // failed — no `sh`, no `awk`, a read-only `/`. An unreachable substrate
    // never gets this far: `exec` throws `SubstrateLinkError` for that, which
    // is the whole reason this branch can now say something specific instead of
    // listing every possible cause.
    throw guestCommandError(`failed to probe ${label} at ${link.description}:${vmPath}`, probe);
  }
  const [substrateMachine = '', vmSha256Raw = ''] = probe.stdout.split('\n');
  const vmSha256 = vmSha256Raw.trim();

  // 3. Refuse a binary that cannot start here — BEFORE the idempotency check,
  //    so a substrate that was swapped for one of the other architecture is
  //    caught rather than sha-matched against bytes installed by a previous
  //    host. `assertArtifactArch` throws `ArtifactArchMismatchError`, named so
  //    the reader lands on the build that produced the bytes instead of on the
  //    test that first tried to run them.
  assertArtifactArch({
    bytes: hostBytes,
    artifactPath: binaryPath,
    substrateMachine: substrateMachine.trim(),
    substrateDescription: link.description,
    label,
  });

  if (vmSha256 && vmSha256 === hostSha256) {
    return { substrate: link.description, vmPath, hostSha256, skipped: true };
  }

  // 4. Stage + atomically install.
  await installIntoSubstrate({
    link,
    hostPath: binaryPath,
    guestPath: vmPath,
    stagePath: `/tmp/podkit-transfer-${randomUUID()}`,
    mode: '0755',
    label,
  });

  return { substrate: link.description, vmPath, hostSha256, skipped: false };
}
