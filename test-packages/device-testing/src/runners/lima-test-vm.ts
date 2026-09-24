/**
 * The device harness — a `TestRuntime` over whichever substrate this machine
 * drives.
 *
 * Stitches the harness primitives together:
 *
 *   - `lima-test-vm-binary.ts` — host→substrate binary transfer (idempotent,
 *     atomic)
 *   - `lima-test-vm-state.ts` — `applyState(stateId)`: stage + run
 *     apply-state.sh
 *   - the FunctionFS daemon at `test-packages/device-testing-daemon/`
 *
 * Nothing below names a provisioner. Everything reaches the substrate through a
 * {@link SubstrateLink}, and which link that is — `limactl` to a Lima VM, `ssh`
 * to a box a hypervisor or a human produced — is resolved once in
 * `./substrate.js`. That is the whole of ADR-028 §1: the harness was tied to
 * macOS not by its logic but by a `vmName: string` threaded through every
 * helper down to a hand-assembled `limactl shell`.
 *
 * Lifecycle (per ADR-016 §"VM"):
 *
 *   isAvailable() — whether the selected substrate answers. Never throws, so an
 *                   unavailable substrate is a skip rather than a suite error.
 *   prepare()     — brings the substrate up where this repo owns its
 *                   provisioner, transfers the podkit binary (fatal if
 *                   missing) and gpod-tool (fatal if missing — produce one with
 *                   `bun run harness:install`), transfers the dummy-hcd-daemon
 *                   (best-effort), emits the persona sidecar at
 *                   /var/device-testing/personas.json.
 *   applyState()  — delegates to `applyState({ link, stateId })`. Stages and
 *                   runs apply-state.sh every time (~800ms). No snapshot
 *                   fast-path (see ADR-016).
 *   run()         — runs the command in the substrate, honouring
 *                   cwd/env/timeout opts.
 *   teardown()    — no-op between groups; the next applyState() call restores
 *                   the substrate to the required state. Does NOT shut it down.
 *
 * Mass-storage backing files and the daemon's systemd lifecycle have separate
 * helpers (`stageBackingFile`, `resetBackingFile`, `startDaemonForPersona`,
 * `stopDaemon`) that the VM tests call between `prepare()` and `run()`. The
 * harness does not auto-start the daemon — tests choose when, because the
 * daemon is per-persona.
 *
 * @see docs/adr/adr-016-linux-vm-test-harness.md
 * @see docs/adr/adr-028-substrate-agnostic-device-harness.md
 * @see test-packages/device-testing-daemon/README.md
 * @module
 */

import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  guestCommandError,
  shellQuote,
  type SubstrateLink,
  type VmDefinition,
} from '@podkit/substrate';

import type { DevicePersona } from '../personas/types.js';
import { personas as defaultPersonas } from '../personas/index.js';
import { buildSidecar } from '../personas/sidecar-build.js';
import { serializeSidecar } from '../personas/sidecar.js';
import type { SystemState } from '../system-states/types.js';
import type { RunOpts, RunResult, RunnerId, TestRuntime } from '../runtime.js';
import type { SubprocessRunner } from '../subprocess.js';
import { transferBinary, transferGpodTool } from './lima-test-vm-binary.js';
import { applyState as applyStateRaw } from './lima-test-vm-state.js';
import { waitForDiskAttachment, waitForUsbEnumeration } from './lima-enumeration.js';
import { transferSystemdUnit } from './lima-test-vm-systemd.js';
import { ensureBackingFilesForPersonas } from './lima-test-vm-backing-files.js';
import { installIntoSubstrate } from './substrate-install.js';
import {
  createSubstrateLink,
  deviceSubstrateLink,
  ensureSubstrateReady,
  probeSubstrate,
  resolveDeviceSubstrate,
  SUBSTRATE_ROUND_TRIP_TIMEOUT_MS,
  type SubstrateOpts,
} from './substrate.js';
import {
  LIMA_DEVICE_HARNESS_VM_NAME,
  instanceStatus,
  type VmLockOptions,
  resolveDefaultPodkitBinary,
  resolveDefaultPodkitDebugBinary,
  resolveDefaultDaemonLinuxBinary,
  resolveDefaultPodkitMuslBinary,
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultDummyHcdDaemonBinary,
  resolveDefaultGpodToolBinary,
} from '@podkit/lima';

// The Lima substrate (instance name, status probe, host binary resolvers) lives
// in `@podkit/lima`. Re-export the symbols this module has historically
// exported so existing import sites keep resolving. `LIMA_DEVICE_HARNESS_VM_NAME`
// and `instanceStatus` are genuinely Lima-only and are used as such: by
// `harness.ts`, which lifecycles the Lima instance, and by the VM suites that
// name the instance for their own diagnostics.
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

/** Sidecar destination inside the substrate. */
export const SIDECAR_VM_PATH = '/var/device-testing/personas.json';
/** Default destination inside the substrate for the dummy-hcd-daemon binary. */
export const DEFAULT_DUMMY_HCD_DAEMON_VM_PATH = '/usr/local/bin/dummy-hcd-daemon';

const ID: RunnerId = 'device-substrate';

// ---------------------------------------------------------------------------
// Persona sidecar emission
// ---------------------------------------------------------------------------

/** Options for {@link ensurePersonaSidecar}. */
export interface EnsurePersonaSidecarOpts {
  /**
   * Link to the substrate the sidecar is written into. Defaults to the
   * selected device substrate; tests inject a link over a scripted runner.
   */
  link?: SubstrateLink;
  /**
   * Personas to include. Defaults to the full registry. Tests may pass a
   * pruned list (e.g. one persona) to keep the payload tiny.
   */
  personas?: Iterable<DevicePersona>;
  /**
   * Map of persona id → in-substrate backing-file path. Optional; mass-storage
   * personas without an entry here are emitted without a backing-file block.
   */
  backingFilePaths?: Map<string, string>;
  /**
   * In-substrate destination. Defaults to {@link SIDECAR_VM_PATH}. The systemd
   * unit `dummy-hcd-daemon@.service` hard-codes this path; overriding it is
   * only useful in tests.
   */
  vmPath?: string;
}

/** Result of {@link ensurePersonaSidecar}. */
export interface EnsurePersonaSidecarResult {
  /** Final destination inside the substrate (matches `opts.vmPath`). */
  vmPath: string;
}

/**
 * Build a sidecar payload from `opts.personas`, copy it into the substrate, and
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
  const link = opts.link ?? deviceSubstrateLink();
  const vmPath = opts.vmPath ?? SIDECAR_VM_PATH;
  const personaSource = opts.personas ?? defaultPersonas.values();

  const payload = buildSidecar(personaSource, opts.backingFilePaths ?? new Map());
  const json = serializeSidecar(payload);

  // Write to a unique host-side temp file so concurrent test runs do not
  // race on a shared path. The bytes go through a file rather than through the
  // link's stdin because there is no link stdin: see the note on
  // `SubstrateLink` for why adding one would fork the two provisioners.
  const hostTmp = path.join(os.tmpdir(), `podkit-personas-${randomUUID()}.json`);
  fs.writeFileSync(hostTmp, json, 'utf8');

  try {
    // `install -D` creates `/var/device-testing` on a substrate that has never
    // had a sidecar.
    await installIntoSubstrate({
      link,
      hostPath: hostTmp,
      guestPath: vmPath,
      stagePath: `/tmp/personas-${randomUUID()}.json`,
      mode: '0644',
      createParents: true,
      label: 'persona sidecar',
    });
  } finally {
    // Always clean up the host-side temp, even if a link step threw.
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
  /**
   * Link to the substrate the image is staged into. Defaults to the selected
   * device substrate.
   */
  link?: SubstrateLink;
  /** Absolute host path to the FAT32 image. */
  hostImagePath: string;
  /** Absolute in-substrate path where the daemon expects the image. */
  vmPath: string;
}

/**
 * Copy a backing-file image from the host into the substrate. Idempotent on
 * sha256 match (skips the copy when the substrate already has the right file).
 *
 * This is the "stage once" step. The companion {@link resetBackingFile}
 * resets the image between tests within a single persona group.
 */
export async function stageBackingFile(opts: StageBackingFileOpts): Promise<void> {
  const link = opts.link ?? deviceSubstrateLink();
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

  // Probe — same shape as the binary-transfer helper. A missing file leaves
  // the pipeline's exit code at `awk`'s zero with empty stdout, so non-zero
  // here means the guest's probe itself failed; an unreachable substrate
  // throws out of `exec` instead.
  const probe = await link.exec([
    'sh',
    '-c',
    `sha256sum ${shellQuote(opts.vmPath)} 2>/dev/null | awk '{print $1}'`,
  ]);
  if (probe.exitCode !== 0) {
    throw guestCommandError(
      `failed to probe backing file at ${link.description}:${opts.vmPath}`,
      probe
    );
  }
  if (probe.stdout.trim() === hostSha) return;

  await installIntoSubstrate({
    link,
    hostPath: opts.hostImagePath,
    guestPath: opts.vmPath,
    stagePath: `/tmp/backing-${randomUUID()}.img`,
    mode: '0644',
    createParents: true,
    label: 'backing file',
  });
}

/** Options for {@link resetBackingFile}. */
export interface ResetBackingFileOpts {
  /**
   * Link to the substrate holding the image. Defaults to the selected device
   * substrate.
   */
  link?: SubstrateLink;
  /** Host-side reference image — source of truth for resets. */
  hostImagePath: string;
  /** Active path inside the substrate (what the daemon reads). */
  vmPath: string;
  /**
   * Reset strategy:
   *
   * - `copy`: re-send the host reference image to `vmPath` every reset.
   *   Simple, slow for large images.
   * - `swap`: send the host reference image to `<vmPath>.ref` once (idempotent
   *   on sha256), then `cp <vmPath>.ref <vmPath>` for each reset. Fast for the
   *   common "many resets, one stage" path.
   */
  strategy: 'copy' | 'swap';
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
  const link = opts.link ?? deviceSubstrateLink();
  if (opts.strategy === 'copy') {
    await stageBackingFile({
      link,
      hostImagePath: opts.hostImagePath,
      vmPath: opts.vmPath,
    });
    return;
  }

  // 'swap' strategy.
  const refPath = `${opts.vmPath}.ref`;
  // Stage the reference (idempotent). Then materialise the active copy.
  await stageBackingFile({
    link,
    hostImagePath: opts.hostImagePath,
    vmPath: refPath,
  });
  const cpResult = await link.exec(['sudo', 'cp', '-f', refPath, opts.vmPath]);
  if (cpResult.exitCode !== 0) {
    throw guestCommandError(
      `swap strategy: failed to refresh ${opts.vmPath} from ${refPath} in ${link.description}`,
      cpResult
    );
  }
}

// ---------------------------------------------------------------------------
// Daemon lifecycle (systemd instance unit)
// ---------------------------------------------------------------------------

/**
 * Bound for starting or stopping a persona's daemon unit.
 *
 * `systemctl start` is `Type=simple` and returns as soon as the daemon
 * `exec()`s; `systemctl stop` is bounded by the unit's own `TimeoutStopSec`
 * before systemd escalates to SIGKILL. Neither can legitimately take anywhere
 * near this long — the headroom is for the SSH round trip on a loaded host,
 * not for the systemd operation itself.
 *
 * Without a bound, a wedged link here blocks the test's hook with no upper
 * limit at all, and the suite reports a hook that ran for minutes with no
 * indication of what it was waiting on.
 */
export const DAEMON_LIFECYCLE_TIMEOUT_MS = SUBSTRATE_ROUND_TRIP_TIMEOUT_MS;

/** Options for {@link startDaemonForPersona}. */
export interface StartDaemonOpts {
  /**
   * Link to the substrate the daemon runs in. Defaults to the selected device
   * substrate.
   */
  link?: SubstrateLink;
  /**
   * The persona to start. Taken as the whole object rather than an id
   * because the primitive waits for *this* persona's gadget to enumerate,
   * which needs its `vid:pid` and whether it carries a mass-storage backing
   * file. A caller that cannot name the persona cannot be given a daemon
   * whose readiness we are able to establish.
   */
  persona: DevicePersona;
  /**
   * Budget for each enumeration wait. Defaults to
   * {@link ENUMERATION_TIMEOUT_MS}; production callers leave it unset. It is
   * a seam so the never-enumerates path can be unit-tested in milliseconds
   * rather than by waiting out the real budget.
   */
  enumerationTimeoutMs?: number;
}

/** Options for {@link stopDaemon}. */
export interface StopDaemonOpts {
  /**
   * Link to the substrate the daemon runs in. Defaults to the selected device
   * substrate.
   */
  link?: SubstrateLink;
  /** Persona id; if omitted, all instances of the template are stopped. */
  personaId?: string;
}

/**
 * Start `dummy-hcd-daemon@<persona.id>.service` inside the VM and wait until
 * the persona's gadget has enumerated.
 *
 * The wait is not optional and there is no un-waited variant. The unit is
 * `Type=simple`, so `systemctl start` returns at daemon `exec()` — 2-3 seconds
 * before the kernel finishes enumerating the gadget — and the resulting
 * failure is silent rather than loud: `podkit device scan` against an empty
 * bus returns zero devices, which reads as a legitimate result. A test
 * asserting "no unsupported device appears" would pass for the wrong reason.
 *
 * Every persona gets the USB wait; personas carrying a mass-storage backing
 * file additionally wait for their own disk to attach, which the kernel does
 * after the USB bind. Both waits match the persona's `vid:pid`, so a second
 * persona starting while a first is bound waits for its own gadget rather
 * than being satisfied by the other's. Both fail loudly with the daemon
 * journal and the UDC slot budget attached, so a genuine synthesis failure
 * still surfaces as itself.
 *
 * Callers that previously paired this with their own `waitFor*` call no
 * longer need one — the wait is now built in.
 */
export async function startDaemonForPersona(opts: StartDaemonOpts): Promise<void> {
  const link = opts.link ?? deviceSubstrateLink();
  if (!opts.persona?.id) throw new Error('startDaemonForPersona: persona is required.');

  const unit = `dummy-hcd-daemon@${opts.persona.id}.service`;
  const result = await link.exec(['sudo', 'systemctl', 'start', unit], {
    timeoutMs: DAEMON_LIFECYCLE_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw guestCommandError(`failed to start ${unit} in ${link.description}`, result);
  }

  const timeoutMs = opts.enumerationTimeoutMs;
  await waitForUsbEnumeration({
    link,
    persona: opts.persona,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  if (opts.persona.massStorageBackingFile !== null) {
    await waitForDiskAttachment({
      link,
      persona: opts.persona,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  }
}

/** Stop the daemon for `opts.personaId` (or all instances if absent). */
export async function stopDaemon(opts: StopDaemonOpts): Promise<void> {
  const link = opts.link ?? deviceSubstrateLink();

  const unit = opts.personaId
    ? `dummy-hcd-daemon@${opts.personaId}.service`
    : 'dummy-hcd-daemon@*.service';
  const result = await link.exec(['sudo', 'systemctl', 'stop', unit], {
    timeoutMs: DAEMON_LIFECYCLE_TIMEOUT_MS,
  });
  // systemd exit 5 = "no such unit / not loaded / not running" — treat as
  // success so callers (notably teardown) can `stopDaemon` blindly without
  // first checking whether anything is running.
  if (result.exitCode !== 0 && result.exitCode !== 5) {
    throw guestCommandError(`failed to stop ${unit} in ${link.description}`, result);
  }
}

// ---------------------------------------------------------------------------
// Harness construction
// ---------------------------------------------------------------------------

/** Options for {@link createDeviceHarness}. */
export interface CreateDeviceHarnessOpts {
  /**
   * Registry entry of the substrate to drive. Production callers leave it unset
   * and get the selected one, resolved lazily on first use; tests name one so a
   * unit run never consults the machine's own configuration.
   */
  substrate?: VmDefinition;
  /**
   * Link to that substrate. Defaults to one dispatched from its provisioner —
   * which is what tests want, since injecting {@link subprocess} then scripts
   * the link's own invocations too.
   */
  link?: SubstrateLink;
  /**
   * DI seam for the PROVISIONER's host-side commands — `limactl list --json`,
   * `limactl start`. Deliberately separate from the link: reading whether a
   * Lima instance exists is a question about the host's Lima state, and a link
   * into a guest cannot answer it. Production callers leave it unset.
   */
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
  /**
   * Advisory-lock tuning for a Lima boot. Production callers leave this unset
   * (the real per-instance lock in the OS temp dir); tests point it at a temp
   * directory so a unit run never contends with a real VM's lock. Meaningless
   * for a substrate this repo does not lifecycle.
   */
  lock?: VmLockOptions;
}

/**
 * Build a device harness over a substrate. The default singleton is exported as
 * {@link deviceHarness}; tests use this factory to inject a link over a
 * scripted subprocess runner.
 *
 * The link is resolved LAZILY. Constructing the singleton at module scope is
 * what lets 29 test files import it by name, and resolving a substrate
 * selection eagerly would make every one of those imports fail on a machine
 * with nothing configured — including a pure unit run that never touches a
 * substrate. See `./substrate.js`.
 */
export function createDeviceHarness(opts: CreateDeviceHarnessOpts = {}): TestRuntime {
  const subOpts: SubstrateOpts = opts.subprocess ? { subprocess: opts.subprocess } : {};

  let target: { definition: VmDefinition; link: SubstrateLink } | null = null;
  /** The substrate and the link to it, resolved once and only when first used. */
  const resolve = (): { definition: VmDefinition; link: SubstrateLink } => {
    if (target) return target;
    const definition = opts.substrate ?? resolveDeviceSubstrate(subOpts).definition;
    target = { definition, link: opts.link ?? createSubstrateLink(definition, subOpts) };
    return target;
  };
  const link = () => resolve().link;
  const resolvePodkitBinary = opts.resolvePodkitBinary ?? (() => resolveDefaultPodkitBinary());
  const resolveDummyHcdDaemonBinary =
    opts.resolveDummyHcdDaemonBinary ?? (() => resolveDefaultDummyHcdDaemonBinary());
  const resolveDummyHcdDaemonUnit = opts.resolveDummyHcdDaemonUnit;
  const resolveGpodToolBinary =
    opts.resolveGpodToolBinary ?? (() => resolveDefaultGpodToolBinary());
  const lock = opts.lock;

  return {
    id: ID,
    async isAvailable() {
      return (await probeSubstrate(resolve().definition, subOpts)) !== 'unreachable';
    },
    async prepare() {
      // 1. Bring the substrate up, where this repo owns its provisioner. A
      //    Lima instance that is merely stopped is started through the shared
      //    advisory lock so this never races another starter; anything else is
      //    a descriptive error rather than a silent conjuring. See
      //    `ensureSubstrateReady`.
      await ensureSubstrateReady(resolve().definition, {
        ...subOpts,
        ...(lock ? { lock } : {}),
      });

      // 2. Transfer the podkit binary. This is the only artefact whose
      //    absence should be fatal: tests can't run without it.
      const podkitPath = resolvePodkitBinary();
      await transferBinary({ link: link(), binaryPath: podkitPath });

      // 3. Transfer gpod-tool — REQUIRED. Tests inside the substrate populate
      //    iPod databases via gpod-tool; a missing host binary is fatal.
      //    `bun run harness:install` produces the Linux build and stages it
      //    at the resolver's default path.
      const gpodToolPath = resolveGpodToolBinary();
      await transferGpodTool({ link: link(), binaryPath: gpodToolPath });

      // 4. Transfer the dummy-hcd-daemon — best-effort. Persona tests need
      //    it; doctor-only tests don't.
      const daemonPath = resolveDummyHcdDaemonBinary();
      if (fs.existsSync(daemonPath)) {
        try {
          await transferBinary({
            link: link(),
            binaryPath: daemonPath,
            vmPath: DEFAULT_DUMMY_HCD_DAEMON_VM_PATH,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[device-harness] dummy-hcd-daemon transfer failed (continuing): ` +
              (err instanceof Error ? err.message : String(err))
          );
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[device-harness] dummy-hcd-daemon binary not found at ${daemonPath} ` +
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
        link: link(),
        ...(hostUnitPath !== undefined ? { hostUnitPath } : {}),
      });

      // 6. Synthesise mass-storage backing files for personas that declare a
      //    `synthesis` recipe. The image is built inside the substrate (no host
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
        link: link(),
        personas: personaList,
      });

      // 7. Emit the persona sidecar. Idempotent: byte-identical payload for
      //    a fixed registry, so re-running prepare() is a no-op for the daemon.
      await ensurePersonaSidecar({
        link: link(),
        personas: personaList,
        backingFilePaths,
      });
    },
    async applyState(state: SystemState) {
      await applyStateRaw({ link: link(), stateId: state.id });
    },
    async run(command: string, runOpts?: RunOpts) {
      const result = await link().exec(command, runOpts ?? {});
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        // Always `null`: a link proxies through ssh and does not surface the
        // guest's signal back to the host. A timeout that fires surfaces as a
        // thrown `SubstrateLinkError` naming the bound.
        signal: null,
      } satisfies RunResult;
    },
    async teardown() {
      // No-op: the next applyState() call stages and runs apply-state.sh to
      // bring the substrate to the required state. There is no snapshot to
      // restore. The substrate is deliberately NOT shut down — per-group
      // shutdown is too slow.
    },
  };
}

/**
 * Default singleton — used by the auto-register hook in `src/index.ts`, and
 * imported by name from every VM test file.
 *
 * Named for what it is rather than for how it is reached. The previous name
 * said "lima", which was accurate until the same object could be an SSH
 * connection to a box on a hypervisor, at which point it became the kind of
 * name that misleads the next reader (ADR-028 §7 records why "runner" was not
 * an option either — the word already means two other things here).
 */
export const deviceHarness: TestRuntime = createDeviceHarness();
