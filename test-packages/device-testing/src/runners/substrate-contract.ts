/**
 * Host-side driver for the substrate contract scripts.
 *
 * A substrate is any Debian box that satisfies `substrate-contract.sh`. The
 * two halves of that contract — `provision-substrate.sh`, which makes a plain
 * box satisfy it, and `substrate-doctor.sh`, which asserts that it does — are
 * portable Debian bash and know nothing about the provisioner that produced
 * the box. This module is what carries them there and runs them.
 *
 * Both provisioners end up here with the same two steps: copy the scripts in,
 * execute them as root — and they reach them through the same code, because
 * this module talks to a {@link SubstrateLink} rather than to a provisioner's
 * CLI. Lima's link spells those steps `limactl copy` / `limactl shell`; an SSH
 * substrate's spells them `scp` / `ssh`. That symmetry is deliberate: it is
 * what stops the Lima path and the Proxmox path from being two
 * separately-correct implementations, which is the failure mode ADR-028
 * diagnoses about the harness generally.
 *
 * Lima cannot reference an external file from a `provision:` block (its entries
 * take an inline `script` or inline `content`), so provisioning runs post-boot
 * from here rather than at first boot. The Lima YAML's job shrinks to producing
 * a plain Debian box, which is all ADR-028 asks a provisioner for.
 *
 * @module
 */

import * as path from 'node:path';

import { repoRoot } from '@podkit/lima';
import { guestCommandError, type SubstrateLink } from '@podkit/substrate';

import { deviceSubstrateLink } from './substrate.js';
import { installIntoSubstrate } from './substrate-install.js';

/**
 * Directory the contract scripts are installed into inside a substrate.
 * Under `/usr/local/lib` rather than `/tmp` so a doctor run long after
 * provisioning still finds the constants its provisioning was performed from.
 */
export const SUBSTRATE_SCRIPT_DIR = '/usr/local/lib/podkit-substrate';

/**
 * The contract, in dependency order. `substrate-contract.sh` is sourced by the
 * other two, so it is not independently runnable — but it must travel with
 * them, since a doctor reading different constants from the provisioning that
 * produced the box is worse than no doctor.
 */
export const SUBSTRATE_SCRIPTS = [
  'substrate-contract.sh',
  'provision-substrate.sh',
  'substrate-doctor.sh',
] as const;

/** Host directory holding the contract scripts. */
export function substrateScriptDir(): string {
  return path.resolve(repoRoot(), 'test-packages', 'device-testing', 'scripts');
}

/** Guest path of one contract script. */
export function substrateScriptVmPath(script: (typeof SUBSTRATE_SCRIPTS)[number]): string {
  return path.posix.join(SUBSTRATE_SCRIPT_DIR, script);
}

export interface SubstrateContractOpts {
  /**
   * Link to the substrate the scripts are carried to. Defaults to the selected
   * device substrate; tests inject a link over a recording runner, which is
   * what pins the two-step shape a second provisioner has to reproduce.
   */
  link?: SubstrateLink;
}

/**
 * Copying is bounded generously: it is three small files, but it opens an SSH
 * session per file and a wedged session must not hang a setup run forever.
 */
const COPY_TIMEOUT_MS = 60_000;

/**
 * Provisioning runs apt-get, so its bound is measured in minutes rather than
 * seconds — a cold `apt-get update && install` over a slow mirror is legitimately
 * slow, and a bound that fires on a working run is worse than none.
 */
const PROVISION_TIMEOUT_MS = 15 * 60_000;

/** The doctor only inspects, so anything beyond a few seconds is a wedge. */
const DOCTOR_TIMEOUT_MS = 60_000;

/**
 * Copy the contract scripts into a substrate, installing them mode 0755 under
 * {@link SUBSTRATE_SCRIPT_DIR}.
 *
 * Files land in `/tmp` first and are then `sudo install`ed into place, rather
 * than being copied to their destination directly: every link copies as the
 * unprivileged guest user and cannot write under `/usr/local/lib`.
 */
export async function copySubstrateScripts(opts: SubstrateContractOpts): Promise<void> {
  const link = opts.link ?? deviceSubstrateLink();
  const hostDir = substrateScriptDir();

  const mkdir = await link.exec(['sudo', 'install', '-d', '-m', '0755', SUBSTRATE_SCRIPT_DIR], {
    timeoutMs: COPY_TIMEOUT_MS,
  });
  if (mkdir.exitCode !== 0) {
    throw guestCommandError(
      `failed to create ${SUBSTRATE_SCRIPT_DIR} in \`${link.description}\``,
      mkdir
    );
  }

  for (const script of SUBSTRATE_SCRIPTS) {
    // The shared installer rather than a local copy/install pair: it is the
    // same three steps, and it is the one that also sweeps the staged copy out
    // of `/tmp` afterwards. The explicit `install -d` above stays rather than
    // being folded into the installer's `createParents`, because a directory
    // this provisioning owns should fail as itself rather than as "could not
    // install substrate-contract.sh".
    await installIntoSubstrate({
      link,
      hostPath: path.join(hostDir, script),
      guestPath: substrateScriptVmPath(script),
      stagePath: path.posix.join('/tmp', script),
      mode: '0755',
      label: script,
      copyTimeoutMs: COPY_TIMEOUT_MS,
      installTimeoutMs: COPY_TIMEOUT_MS,
    });
  }
}

/**
 * Copy the contract scripts in and run `provision-substrate.sh` as root.
 *
 * Deliberately does not verify its own work — call {@link runSubstrateDoctor}
 * for that. A provisioner that grades itself tends to grade generously, and
 * the whole point of the doctor is that it is the same check on every
 * substrate regardless of what provisioned it.
 */
export async function provisionSubstrate(opts: SubstrateContractOpts): Promise<void> {
  const link = opts.link ?? deviceSubstrateLink();
  await copySubstrateScripts({ link });

  const result = await link.exec(
    ['sudo', 'bash', substrateScriptVmPath('provision-substrate.sh')],
    { timeoutMs: PROVISION_TIMEOUT_MS }
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `provision-substrate.sh failed in \`${link.description}\` (exit ${result.exitCode}):\n` +
        `${result.stderr.trim() || result.stdout.trim()}`
    );
  }
}

export interface SubstrateDoctorResult {
  /** True when every contract assertion held. */
  ok: boolean;
  /** The doctor's per-assertion report, for rendering to a developer. */
  stdout: string;
  /** Named failures. Empty on a pass. */
  stderr: string;
}

export interface SubstrateDoctorOpts extends SubstrateContractOpts {
  /**
   * Treat a Debian point release that differs from the template's pin as a
   * failure rather than a note. Off by default: which image was booted is a
   * provisioning input, while the running point release advances with any
   * security update, so a box that has taken an update has not broken the
   * contract. Template validation wants the strict reading.
   */
  strict?: boolean;
  /**
   * Skip the copy and run whatever is already installed in the substrate.
   * Used by drift checks, which want to know what the box currently satisfies
   * rather than what it would satisfy after being re-seeded from the host.
   */
  skipCopy?: boolean;
}

/**
 * Run `substrate-doctor.sh` and report the verdict.
 *
 * Returns the verdict rather than throwing on failure: a failing doctor is an
 * expected outcome that callers render differently depending on context — a
 * gate before `test:vm`, a hint during setup, a drift report from `vm:doctor`.
 */
export async function runSubstrateDoctor(
  opts: SubstrateDoctorOpts
): Promise<SubstrateDoctorResult> {
  const { strict = false, skipCopy = false } = opts;
  const link = opts.link ?? deviceSubstrateLink();
  if (!skipCopy) await copySubstrateScripts({ link });

  const argv = ['sudo', 'bash', substrateScriptVmPath('substrate-doctor.sh')];
  if (strict) argv.push('--strict');

  const result = await link.exec(argv, { timeoutMs: DOCTOR_TIMEOUT_MS });
  return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
}
