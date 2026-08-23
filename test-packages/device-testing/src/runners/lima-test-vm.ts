/**
 * lima-test-vm runner — VM `TestRuntime` backend for macOS dev hosts.
 *
 * Stitches together the primitives landed in Phase 3a/3b/3c:
 *
 *   - `lima-test-vm-binary.ts` — host→VM binary transfer (idempotent, atomic)
 *   - `lima-test-vm-state.ts` — `applyState(stateId)`: stage + run apply-state.sh
 *   - the FunctionFS daemon at `test-packages/device-testing-daemon/`
 *
 * Lifecycle (per ADR-016 §"VM"):
 *
 *   isAvailable() — returns true iff `limactl` is in PATH AND the
 *                   `podkit-device-harness` instance exists. Never throws.
 *   prepare()     — boots the VM if stopped, transfers the podkit binary
 *                   (fatal if missing) and gpod-tool (fatal if missing —
 *                   produce one with `bun run harness:install`), transfers
 *                   the dummy-hcd-daemon (best-effort), emits the persona
 *                   sidecar at /var/device-testing/personas.json.
 *   applyState()  — delegates to applyState({ vmName, stateId }) from
 *                   lima-test-vm-state.ts. Stages and runs apply-state.sh every
 *                   time (~800ms). No snapshot fast-path (see ADR-016).
 *   run()         — `limactl shell podkit-device-harness -- <command>`, honouring
 *                   cwd/env/timeout opts.
 *   teardown()    — no-op between groups; the next applyState() call restores
 *                   the VM to the required state. Does NOT shut down the VM.
 *
 * Mass-storage backing files and the daemon's systemd lifecycle have separate
 * helpers (`stageBackingFile`, `resetBackingFile`, `startDaemonForPersona`,
 * `stopDaemon`) that the VM tests call between
 * `prepare()` and `run()`. The runner does not auto-start the daemon — tests
 * choose when, because the daemon is per-persona.
 *
 * @see adr/adr-016-linux-vm-test-harness.md
 * @see test-packages/device-testing-daemon/README.md
 * @module
 */

import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { DevicePersona } from '../personas/types.js';
import { personas as defaultPersonas } from '../personas/index.js';
import { buildSidecar } from '../personas/sidecar-build.js';
import { serializeSidecar } from '../personas/sidecar.js';
import type { SystemState } from '../system-states/types.js';
import { defaultSubprocessRunner, type SubprocessRunner } from '../subprocess.js';
import type { RunOpts, RunResult, RunnerId, TestRuntime } from '../runtime.js';
import { transferBinary, transferGpodTool } from './lima-test-vm-binary.js';
import { applyState as applyStateRaw } from './lima-test-vm-state.js';
import { limactlError, runLimactl, shellQuote, type LimactlResult } from './lima-limactl.js';
import { transferSystemdUnit } from './lima-test-vm-systemd.js';
import { ensureBackingFilesForPersonas } from './lima-test-vm-backing-files.js';
import {
  LIMA_DEVICE_HARNESS_VM_NAME,
  instanceStatus,
  resolveDefaultPodkitBinary,
  resolveDefaultPodkitDebugBinary,
  resolveDefaultDaemonLinuxBinary,
  resolveDefaultPodkitMuslBinary,
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultDummyHcdDaemonBinary,
  resolveDefaultGpodToolBinary,
} from '@podkit/lima';

// The Lima substrate (instance name, status probe, host binary resolvers) now
// lives in `@podkit/lima`. Re-export the symbols this module has historically
// exported so existing import sites (`./runners/lima-test-vm.js`) keep resolving.
export {
  LIMA_DEVICE_HARNESS_VM_NAME,
  instanceStatus,
  resolveDefaultPodkitBinary,
  resolveDefaultPodkitDebugBinary,
  resolveDefaultDaemonLinuxBinary,
  resolveDefaultPodkitMuslBinary,
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultDummyHcdDaemonBinary,
  resolveDefaultGpodToolBinary,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sidecar destination inside the VM. */
export const SIDECAR_VM_PATH = '/var/device-testing/personas.json';
/** Default destination inside the VM for the dummy-hcd-daemon binary. */
export const DEFAULT_DUMMY_HCD_DAEMON_VM_PATH = '/usr/local/bin/dummy-hcd-daemon';

const ID: RunnerId = 'lima-test-vm';

// ---------------------------------------------------------------------------
// Persona sidecar emission
// ---------------------------------------------------------------------------

/** Options for {@link ensurePersonaSidecar}. */
export interface EnsurePersonaSidecarOpts {
  /** Lima instance name. */
  vmName: string;
  /**
   * Personas to include. Defaults to the full registry. Tests may pass a
   * pruned list (e.g. one persona) to keep the payload tiny.
   */
  personas?: Iterable<DevicePersona>;
  /**
   * Map of persona id → in-VM backing-file path. Optional; mass-storage
   * personas without an entry here are emitted without a backing-file block.
   */
  backingFilePaths?: Map<string, string>;
  /** DI seam for `limactl`. Tests inject a scripted runner. */
  subprocess?: SubprocessRunner;
  /**
   * In-VM destination. Defaults to {@link SIDECAR_VM_PATH}. The systemd unit
   * `dummy-hcd-daemon@.service` hard-codes this path; overriding it is only
   * useful in tests.
   */
  vmPath?: string;
}

/** Result of {@link ensurePersonaSidecar}. */
export interface EnsurePersonaSidecarResult {
  /** Final destination inside the VM (matches `opts.vmPath`). */
  vmPath: string;
}

/**
 * Build a sidecar payload from `opts.personas`, copy it into the VM, and
 * install it at `opts.vmPath`. Cleans up the host-side temp file.
 *
 * Idempotency: the sidecar is regenerated and copied every time. The
 * underlying payload is deterministic for a fixed persona set, so re-running
 * `prepare()` is harmless (the file at `vmPath` is overwritten with byte-
 * identical contents).
 */
export async function ensurePersonaSidecar(
  opts: EnsurePersonaSidecarOpts
): Promise<EnsurePersonaSidecarResult> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const vmPath = opts.vmPath ?? SIDECAR_VM_PATH;
  const personaSource = opts.personas ?? defaultPersonas.values();

  if (!opts.vmName) {
    throw new Error('ensurePersonaSidecar: vmName is required.');
  }

  const payload = buildSidecar(personaSource, opts.backingFilePaths ?? new Map());
  const json = serializeSidecar(payload);

  // Write to a unique host-side temp file so concurrent test runs do not
  // race on a shared path.
  const hostTmp = path.join(os.tmpdir(), `podkit-personas-${randomUUID()}.json`);
  fs.writeFileSync(hostTmp, json, 'utf8');

  // VM-side staging path inside /tmp (tmpfs, no sudo to write).
  const vmTmp = `/tmp/personas-${randomUUID()}.json`;

  try {
    const copyResult = await runLimactl(subprocess, ['copy', hostTmp, `${opts.vmName}:${vmTmp}`]);
    if (copyResult.exitCode !== 0) {
      throw limactlError(`failed to copy personas.json to ${opts.vmName}:${vmTmp}`, copyResult);
    }

    // `install -D -m 0644 <src> <dst>` creates the parent dir and is atomic.
    const installResult = await runLimactl(subprocess, [
      'shell',
      opts.vmName,
      '--',
      'sudo',
      'install',
      '-D',
      '-m',
      '0644',
      vmTmp,
      vmPath,
    ]);
    if (installResult.exitCode !== 0) {
      throw limactlError(
        `sudo install failed promoting ${vmTmp} → ${vmPath} in ${opts.vmName}`,
        installResult
      );
    }

    // Best-effort cleanup of the VM-side temp; /tmp is tmpfs so a leftover
    // is harmless across reboots.
    await runLimactl(subprocess, ['shell', opts.vmName, '--', 'rm', '-f', vmTmp]).catch(
      () => undefined
    );
  } finally {
    // Always clean up the host-side temp, even if a limactl step threw.
    try {
      fs.unlinkSync(hostTmp);
    } catch {
      // Best-effort: a stuck file in /tmp does no harm.
    }
  }

  return { vmPath };
}

// ---------------------------------------------------------------------------
// Mass-storage backing-file lifecycle
// ---------------------------------------------------------------------------

/** Options for {@link stageBackingFile}. */
export interface StageBackingFileOpts {
  vmName: string;
  /** Absolute host path to the FAT32 image. */
  hostImagePath: string;
  /** Absolute VM path where the daemon expects the image. */
  vmPath: string;
  subprocess?: SubprocessRunner;
}

/**
 * Copy a backing-file image from the host into the VM. Idempotent on
 * sha256 match (skips the copy when the VM already has the right file).
 *
 * This is the "stage once" step. The companion {@link resetBackingFile}
 * resets the image between tests within a single persona group.
 */
export async function stageBackingFile(opts: StageBackingFileOpts): Promise<void> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  if (!opts.vmName) throw new Error('stageBackingFile: vmName is required.');
  if (!opts.hostImagePath) throw new Error('stageBackingFile: hostImagePath is required.');
  if (!opts.vmPath) throw new Error('stageBackingFile: vmPath is required.');

  let hostBytes: Buffer;
  try {
    hostBytes = fs.readFileSync(opts.hostImagePath);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`stageBackingFile: cannot read host image at ${opts.hostImagePath} (${cause})`);
  }
  const hostSha = createHash('sha256').update(hostBytes).digest('hex');

  // Probe — same shape as the binary-transfer helper.
  const probe = await runLimactl(subprocess, [
    'shell',
    opts.vmName,
    '--',
    'sh',
    '-c',
    `sha256sum ${shellQuote(opts.vmPath)} 2>/dev/null | awk '{print $1}'`,
  ]);
  if (probe.exitCode !== 0) {
    throw limactlError(`failed to probe backing file at ${opts.vmName}:${opts.vmPath}`, probe);
  }
  if (probe.stdout.trim() === hostSha) return;

  const vmTmp = `/tmp/backing-${randomUUID()}.img`;
  const copyResult = await runLimactl(subprocess, [
    'copy',
    opts.hostImagePath,
    `${opts.vmName}:${vmTmp}`,
  ]);
  if (copyResult.exitCode !== 0) {
    throw limactlError(
      `limactl copy failed sending backing file to ${opts.vmName}:${vmTmp}`,
      copyResult
    );
  }

  const installResult = await runLimactl(subprocess, [
    'shell',
    opts.vmName,
    '--',
    'sudo',
    'install',
    '-D',
    '-m',
    '0644',
    vmTmp,
    opts.vmPath,
  ]);
  if (installResult.exitCode !== 0) {
    await runLimactl(subprocess, ['shell', opts.vmName, '--', 'rm', '-f', vmTmp]).catch(
      () => undefined
    );
    throw limactlError(
      `sudo install failed promoting ${vmTmp} → ${opts.vmPath} in ${opts.vmName}`,
      installResult
    );
  }
  await runLimactl(subprocess, ['shell', opts.vmName, '--', 'rm', '-f', vmTmp]).catch(
    () => undefined
  );
}

/** Options for {@link resetBackingFile}. */
export interface ResetBackingFileOpts {
  vmName: string;
  /** Host-side reference image — source of truth for resets. */
  hostImagePath: string;
  /** Active path inside the VM (what the daemon reads). */
  vmPath: string;
  /**
   * Reset strategy:
   *
   * - `copy`: limactl-copy the host reference image to `vmPath` every reset.
   *   Simple, slow for large images.
   * - `swap`: limactl-copy the host reference image to `<vmPath>.ref` once
   *   (idempotent on sha256), then `cp <vmPath>.ref <vmPath>` for each reset.
   *   Fast for the common "many resets, one stage" path.
   */
  strategy: 'copy' | 'swap';
  subprocess?: SubprocessRunner;
}

/**
 * Reset the backing file to its reference image. Strategy semantics:
 *
 *   - `copy` — always re-copies from host. Acceptable for sub-megabyte
 *     images.
 *   - `swap` — copies host→VM once to `<vmPath>.ref` (idempotent), then
 *     `sudo cp <vmPath>.ref <vmPath>` for every reset.
 */
export async function resetBackingFile(opts: ResetBackingFileOpts): Promise<void> {
  if (opts.strategy === 'copy') {
    await stageBackingFile({
      vmName: opts.vmName,
      hostImagePath: opts.hostImagePath,
      vmPath: opts.vmPath,
      subprocess: opts.subprocess,
    });
    return;
  }

  // 'swap' strategy.
  const refPath = `${opts.vmPath}.ref`;
  // Stage the reference (idempotent). Then materialise the active copy.
  await stageBackingFile({
    vmName: opts.vmName,
    hostImagePath: opts.hostImagePath,
    vmPath: refPath,
    subprocess: opts.subprocess,
  });
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const cpResult = await runLimactl(subprocess, [
    'shell',
    opts.vmName,
    '--',
    'sudo',
    'cp',
    '-f',
    refPath,
    opts.vmPath,
  ]);
  if (cpResult.exitCode !== 0) {
    throw limactlError(
      `swap strategy: failed to refresh ${opts.vmPath} from ${refPath} in ${opts.vmName}`,
      cpResult
    );
  }
}

// ---------------------------------------------------------------------------
// Daemon lifecycle (systemd instance unit)
// ---------------------------------------------------------------------------

/** Options for {@link startDaemonForPersona}. */
export interface StartDaemonOpts {
  vmName: string;
  /** Persona id — used as the systemd instance specifier. */
  personaId: string;
  subprocess?: SubprocessRunner;
}

/** Options for {@link stopDaemon}. */
export interface StopDaemonOpts {
  vmName: string;
  /** Persona id; if omitted, all instances of the template are stopped. */
  personaId?: string;
  subprocess?: SubprocessRunner;
}

/** Start `dummy-hcd-daemon@<personaId>.service` inside the VM. */
export async function startDaemonForPersona(opts: StartDaemonOpts): Promise<void> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  if (!opts.vmName) throw new Error('startDaemonForPersona: vmName is required.');
  if (!opts.personaId) throw new Error('startDaemonForPersona: personaId is required.');

  const unit = `dummy-hcd-daemon@${opts.personaId}.service`;
  const result = await runLimactl(subprocess, [
    'shell',
    opts.vmName,
    '--',
    'sudo',
    'systemctl',
    'start',
    unit,
  ]);
  if (result.exitCode !== 0) {
    throw limactlError(`failed to start ${unit} in ${opts.vmName}`, result);
  }
}

/** Stop the daemon for `opts.personaId` (or all instances if absent). */
export async function stopDaemon(opts: StopDaemonOpts): Promise<void> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  if (!opts.vmName) throw new Error('stopDaemon: vmName is required.');

  const unit = opts.personaId
    ? `dummy-hcd-daemon@${opts.personaId}.service`
    : 'dummy-hcd-daemon@*.service';
  const result = await runLimactl(subprocess, [
    'shell',
    opts.vmName,
    '--',
    'sudo',
    'systemctl',
    'stop',
    unit,
  ]);
  // systemd exit 5 = "no such unit / not loaded / not running" — treat as
  // success so callers (notably VM teardown) can `stopDaemon` blindly
  // without first checking whether anything is running.
  if (result.exitCode !== 0 && result.exitCode !== 5) {
    throw limactlError(`failed to stop ${unit} in ${opts.vmName}`, result);
  }
}

// ---------------------------------------------------------------------------
// Runner construction
// ---------------------------------------------------------------------------

/** Options for {@link createLimaTestVmRuntime}. */
export interface CreateLimaTestVmRuntimeOpts {
  /** Lima instance name. Defaults to {@link LIMA_DEVICE_HARNESS_VM_NAME}. */
  vmName?: string;
  /** DI seam for limactl; production callers leave unset. */
  subprocess?: SubprocessRunner;
  /**
   * Resolver for the podkit binary path. Tests inject a synthetic path; the
   * default reads `PODKIT_LINUX_BINARY` or falls back to the per-arch default
   * under `packages/podkit-cli/bin/`.
   */
  resolvePodkitBinary?: () => string;
  /**
   * Resolver for the dummy-hcd-daemon binary path. Defaults to
   * `test-packages/device-testing-daemon/dist/dummy-hcd-daemon-linux-<arch>`.
   */
  resolveDummyHcdDaemonBinary?: () => string;
  /**
   * Resolver for the dummy-hcd-daemon systemd unit file path on the host.
   * Defaults to `test-packages/device-testing-daemon/dummy-hcd-daemon@.service`;
   * tests inject a synthetic path so the sha256 is deterministic and the
   * runner does not couple to repo bytes.
   */
  resolveDummyHcdDaemonUnit?: () => string;
  /**
   * Resolver for the gpod-tool binary path. Defaults to the per-arch output
   * of `@podkit/gpod-testing#build:linux-binary` (a Linux build produced by
   * `bun run harness:install`). gpod-tool is a required harness dependency;
   * a missing host file fails the transfer with a descriptive error.
   */
  resolveGpodToolBinary?: () => string;
  /** Persona set to emit in the sidecar. Defaults to the full registry. */
  personas?: Iterable<DevicePersona>;
}

/**
 * Build a `lima-test-vm` runner. The default singleton is exported as
 * {@link limaTestVmRunner}; tests use this factory to inject a scripted
 * subprocess runner.
 */
export function createLimaTestVmRuntime(opts: CreateLimaTestVmRuntimeOpts = {}): TestRuntime {
  const vmName = opts.vmName ?? LIMA_DEVICE_HARNESS_VM_NAME;
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const resolvePodkitBinary = opts.resolvePodkitBinary ?? (() => resolveDefaultPodkitBinary());
  const resolveDummyHcdDaemonBinary =
    opts.resolveDummyHcdDaemonBinary ?? (() => resolveDefaultDummyHcdDaemonBinary());
  const resolveDummyHcdDaemonUnit = opts.resolveDummyHcdDaemonUnit;
  const resolveGpodToolBinary =
    opts.resolveGpodToolBinary ?? (() => resolveDefaultGpodToolBinary());

  return {
    id: ID,
    async isAvailable() {
      const status = await instanceStatus(vmName, subprocess);
      return status !== 'missing';
    },
    async prepare() {
      // 1. Boot the VM if stopped. Missing → throw with a clear hint.
      const status = await instanceStatus(vmName, subprocess);
      if (status === 'missing') {
        throw new Error(
          `[lima-test-vm] instance '${vmName}' is not registered with Lima. ` +
            `Create it with: limactl start test-packages/device-testing/lima/podkit-device-harness.yaml --name ${vmName}`
        );
      }
      if (status === 'stopped') {
        const startResult = await runLimactl(subprocess, ['start', vmName]);
        if (startResult.exitCode !== 0) {
          throw limactlError(`failed to start lima instance ${vmName}`, startResult);
        }
      }

      // 2. Transfer the podkit binary. This is the only artefact whose
      //    absence should be fatal: tests can't run without it.
      const podkitPath = resolvePodkitBinary();
      await transferBinary({
        vmName,
        binaryPath: podkitPath,
        subprocess,
      });

      // 3. Transfer gpod-tool — REQUIRED. Tests inside the VM populate
      //    iPod databases via gpod-tool; a missing host binary is fatal.
      //    `bun run harness:install` produces the Linux build and stages it
      //    at the resolver's default path.
      const gpodToolPath = resolveGpodToolBinary();
      await transferGpodTool({
        vmName,
        binaryPath: gpodToolPath,
        subprocess,
      });

      // 4. Transfer the dummy-hcd-daemon — best-effort. Persona tests need
      //    it; doctor-only tests don't.
      const daemonPath = resolveDummyHcdDaemonBinary();
      if (fs.existsSync(daemonPath)) {
        try {
          await transferBinary({
            vmName,
            binaryPath: daemonPath,
            vmPath: DEFAULT_DUMMY_HCD_DAEMON_VM_PATH,
            subprocess,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[lima-test-vm] dummy-hcd-daemon transfer failed (continuing): ` +
              (err instanceof Error ? err.message : String(err))
          );
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[lima-test-vm] dummy-hcd-daemon binary not found at ${daemonPath} ` +
            `— run \`bun run --filter @podkit/device-testing-daemon build\` to produce one.`
        );
      }

      // 5. Install the dummy-hcd-daemon systemd template. Mandatory: without
      //    it, every `startDaemonForPersona` later in the test would fail
      //    with `Unit dummy-hcd-daemon@<id>.service not found`. The helper
      //    sha256-skips when the unit is already up-to-date, and only runs
      //    `systemctl daemon-reload` when the contents actually change.
      const hostUnitPath = resolveDummyHcdDaemonUnit?.();
      await transferSystemdUnit({
        vmName,
        ...(hostUnitPath !== undefined ? { hostUnitPath } : {}),
        subprocess,
      });

      // 6. Synthesise mass-storage backing files for personas that declare a
      //    `synthesis` recipe. The image is built inside the VM (no host
      //    roundtrip) via `truncate` + `mkfs.vfat --invariant`, producing
      //    byte-identical FAT32 every run. The returned map feeds step 7's
      //    sidecar so the daemon sees `massStorageBackingFile.vmPath` pointing
      //    at the just-synthesised image.
      const personaSource = opts.personas ?? defaultPersonas.values();
      // Materialise the iterable so we can re-use it for both backing-file
      // synthesis AND sidecar emission (Iterables from the registry are
      // single-use Map iterators).
      const personaList = Array.from(personaSource);
      const backingFilePaths = await ensureBackingFilesForPersonas({
        vmName,
        personas: personaList,
        subprocess,
      });

      // 7. Emit the persona sidecar. Idempotent: byte-identical payload for
      //    a fixed registry, so re-running prepare() is a no-op for the daemon.
      await ensurePersonaSidecar({
        vmName,
        personas: personaList,
        backingFilePaths,
        subprocess,
      });
    },
    async applyState(state: SystemState) {
      await applyStateRaw({
        vmName,
        stateId: state.id,
        subprocess,
      });
    },
    async run(command: string, runOpts?: RunOpts) {
      return runViaLimactl(subprocess, vmName, command, runOpts);
    },
    async teardown() {
      // No-op: the next applyState() call stages and runs apply-state.sh to
      // bring the VM to the required state. There is no snapshot to restore.
      // The VM is deliberately NOT shut down — per-group shutdown is too slow.
    },
  };
}

/**
 * Default singleton — used by the auto-register hook in `src/index.ts`.
 */
export const limaTestVmRunner: TestRuntime = createLimaTestVmRuntime();

// ---------------------------------------------------------------------------
// `run` implementation
// ---------------------------------------------------------------------------

/**
 * Run a single shell command inside the VM via `limactl shell <vm> -- …`.
 *
 * Argument shape: limactl forwards everything after `--` to the in-VM shell
 * as one literal argv vector. We honour `opts.cwd` and `opts.env` by
 * synthesising a small `sh -c` wrapper that exports the env, cds, and execs
 * the user's command. `opts.timeoutMs` is enforced via the host-side
 * `SubprocessRunner` shape's `timeoutMs` option (passed through directly).
 *
 * The `signal` field is always `null`: limactl proxies through ssh and does
 * not surface the in-VM signal back to the host. A timeout that fires
 * surfaces as `exitCode = 124` (the conventional `timeout(1)` exit code) via
 * the underlying subprocess runner.
 */
async function runViaLimactl(
  subprocess: SubprocessRunner,
  vmName: string,
  command: string,
  opts: RunOpts = {}
): Promise<RunResult> {
  const wrapped = wrapCommand(command, opts);
  let result: LimactlResult;
  const subprocessOpts =
    typeof opts.timeoutMs === 'number' ? { timeoutMs: opts.timeoutMs } : undefined;
  try {
    result = await subprocess.run(
      'limactl',
      ['shell', vmName, '--', 'sh', '-c', wrapped],
      subprocessOpts
    );
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    const hint = /ENOENT|not found/i.test(cause)
      ? ' (is `limactl` installed? `brew install lima`)'
      : '';
    throw new Error(`limactl shell ${vmName} failed: ${cause}${hint}`);
  }
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    signal: null,
  };
}

/**
 * Wrap a user command so the VM-side `sh -c` honours `cwd` and `env`. Env
 * vars are exported as `K='…'` (POSIX single-quote form; embedded single
 * quotes are escaped as `'\''` by `shellQuote`).
 */
function wrapCommand(command: string, opts: RunOpts): string {
  const segments: string[] = [];
  if (opts.env) {
    for (const [key, value] of Object.entries(opts.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`runOpts.env: invalid variable name '${key}'`);
      }
      segments.push(`export ${key}=${shellQuote(value)}`);
    }
  }
  if (opts.cwd) {
    segments.push(`cd ${shellQuote(opts.cwd)}`);
  }
  segments.push(command);
  return segments.join('; ');
}
