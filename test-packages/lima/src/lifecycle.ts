/**
 * Idempotent VM lifecycle primitives — the one implementation of
 * "check status → create/start/stop/destroy" that every caller shares.
 *
 * Every path that can CREATE or START a VM funnels through the single advisory
 * lock ({@link withVmLock}) with the status read taken INSIDE the lock, so the
 * check-then-act decision is atomic across processes. `ensureRunning` never
 * stops a VM, and nothing here reference-counts — only {@link stop}/{@link destroy}
 * tear a VM down.
 *
 * All `limactl` calls go through the injected `SubprocessRunner` seam so the
 * decisions are unit-testable with scripted outputs.
 *
 * @module
 */

import { defaultSubprocessRunner, type SubprocessRunner } from '@podkit/device-types';
import { limactlError, runLimactl } from './limactl.js';
import { instanceStatus, type InstanceStatus } from './instance-status.js';
import { getVm, type VmDefinition } from './registry.js';
import { withVmLock, type VmLockOptions } from './lock.js';

// ---------------------------------------------------------------------------
// Wall-clock bounds
//
// These are ASYMMETRIC on purpose, and the asymmetry is the whole design.
//
// `stop`, `destroy` and a warm `start` act on an instance that already exists.
// Their legitimate duration is bounded by things we can name — a guest's
// shutdown-job timeout, the removal of a disk image, a boot plus the per-boot
// provision scripts — so a wall clock is the right instrument, and an
// unbounded one is how a `vm:down` racing an in-flight boot hangs silently for
// minutes with nothing to distinguish it from work.
//
// A COLD create is different in kind: it downloads a cloud image and runs
// cloud-init, and no wall-clock bound is simultaneously tight enough to catch a
// wedge and loose enough to spare a legitimate provision — and aborting one
// mid-flight leaves a half-created instance, which is worse than the hang. That
// path is therefore bounded by LIVENESS instead (no output for
// `PROVISIONING_IDLE_TIMEOUT_MS`, see `./streaming-runner.js`), and passes no
// `timeoutMs` here. That is deliberate, not an oversight.
// ---------------------------------------------------------------------------

/**
 * Bound for `limactl stop` — a graceful guest shutdown.
 *
 * The dominant term is the guest init system's stop-job timeout: systemd's
 * `DefaultTimeoutStopSec` is 90s on Debian, and a single unit that refuses to
 * die costs exactly that before the shutdown proceeds. Budget two such jobs
 * plus the hypervisor teardown. Below 90s this would abort shutdowns that were
 * always going to succeed; far above it, it stops being a bound.
 */
export const STOP_TIMEOUT_MS = 180_000;

/**
 * Bound for `limactl delete --force`.
 *
 * Lower than {@link STOP_TIMEOUT_MS} because `--force` does not wait on a
 * graceful guest shutdown at all — it tears the hypervisor down and removes the
 * instance directory, so the dominant term is unlinking a multi-gigabyte
 * diffdisk. One stop-job timeout's worth of headroom covers a driver that
 * falls back to a polite stop on the way out.
 */
export const DESTROY_TIMEOUT_MS = 90_000;

/**
 * Bound for a WARM `limactl start <name>` — an instance that already exists and
 * is merely stopped.
 *
 * Not as short as "just a boot": Lima re-runs every `mode: system` / `mode:
 * user` provision script on every boot, so a warm start of the device VM
 * repeats its `apt-get update`/install and its provisioning guards. Its
 * legitimate worst case is therefore a cold create minus the image download —
 * the top of the five-to-ten-minute range this package documents for a cold
 * start. Anything past that is not a slow boot.
 */
export const WARM_START_TIMEOUT_MS = 600_000;

/** Common options threaded through the lifecycle primitives. */
export interface LifecycleOpts {
  /** DI seam for `limactl`; production callers leave unset. */
  subprocess?: SubprocessRunner;
  /** Advisory-lock tuning; production callers leave unset. */
  lock?: VmLockOptions;
}

/** Resolve a VM definition from an id, instance name, or definition object. */
function resolve(vm: string | VmDefinition): VmDefinition {
  return typeof vm === 'string' ? getVm(vm) : vm;
}

/**
 * Report the current status of a VM. Thin wrapper over {@link instanceStatus}
 * that accepts a registry id / instance name / definition.
 */
export async function status(
  vm: string | VmDefinition,
  opts: LifecycleOpts = {}
): Promise<InstanceStatus> {
  const def = resolve(vm);
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  return instanceStatus(def.instanceName, subprocess);
}

/**
 * Ensure the VM instance EXISTS (registered with Lima), creating it from its
 * registry YAML if missing. Does not start it. Idempotent: a no-op when the
 * instance already exists. The check-then-create runs inside the lock.
 */
export async function ensureExists(
  vm: string | VmDefinition,
  opts: LifecycleOpts = {}
): Promise<void> {
  const def = resolve(vm);
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  await withVmLock(
    def.instanceName,
    async () => {
      const current = await instanceStatus(def.instanceName, subprocess);
      if (current !== 'missing') return;
      // No `timeoutMs`: a cold create is bounded by liveness, not the clock.
      // See the wall-clock bounds note at the top of this module.
      const result = await runLimactl(subprocess, [
        'create',
        '--tty=false',
        '--name',
        def.instanceName,
        def.yamlPath,
      ]);
      if (result.exitCode !== 0) {
        throw limactlError(`failed to create lima instance ${def.instanceName}`, result);
      }
    },
    opts.lock
  );
}

/**
 * Ensure the VM instance is RUNNING: create it if missing, start it if stopped,
 * no-op if already running. The whole check-then-act sequence runs inside the
 * lock so a concurrent caller cannot start the same instance simultaneously.
 * Never stops a running VM.
 */
export async function ensureRunning(
  vm: string | VmDefinition,
  opts: LifecycleOpts = {}
): Promise<void> {
  const def = resolve(vm);
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  await withVmLock(
    def.instanceName,
    async () => {
      const current = await instanceStatus(def.instanceName, subprocess);
      if (current === 'running') return;
      if (current === 'missing') {
        // Cold create: no wall-clock bound (see the note at the top of this
        // module). Production callers reach this path only through the CLI or
        // the harness, both of which supply the streaming provisioning runner,
        // so the no-output watchdog applies.
        const created = await runLimactl(subprocess, [
          'start',
          '--tty=false',
          `--name=${def.instanceName}`,
          def.yamlPath,
        ]);
        if (created.exitCode !== 0) {
          throw limactlError(`failed to create+start lima instance ${def.instanceName}`, created);
        }
        return;
      }
      // stopped → start. Bounded: unlike the create above, this instance
      // already exists, so its duration is a boot plus the per-boot provision
      // scripts rather than an image download.
      const started = await runLimactl(subprocess, ['start', def.instanceName], {
        timeoutMs: WARM_START_TIMEOUT_MS,
      });
      if (started.exitCode !== 0) {
        throw limactlError(`failed to start lima instance ${def.instanceName}`, started);
      }
    },
    opts.lock
  );
}

/**
 * Stop the VM. No-op if it is missing or already stopped. Not lock-guarded —
 * stopping is an explicit, non-racy operation.
 */
export async function stop(vm: string | VmDefinition, opts: LifecycleOpts = {}): Promise<void> {
  const def = resolve(vm);
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const current = await instanceStatus(def.instanceName, subprocess);
  if (current === 'missing' || current === 'stopped') return;
  const result = await runLimactl(subprocess, ['stop', def.instanceName], {
    timeoutMs: STOP_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw limactlError(`failed to stop lima instance ${def.instanceName}`, result);
  }
}

/**
 * Destroy the VM (`limactl delete --force`). No-op if already missing.
 */
export async function destroy(vm: string | VmDefinition, opts: LifecycleOpts = {}): Promise<void> {
  const def = resolve(vm);
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const current = await instanceStatus(def.instanceName, subprocess);
  if (current === 'missing') return;
  const result = await runLimactl(subprocess, ['delete', '--force', def.instanceName], {
    timeoutMs: DESTROY_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw limactlError(`failed to delete lima instance ${def.instanceName}`, result);
  }
}

/** Options for {@link recover}. */
export interface RecoverOpts extends LifecycleOpts {
  /**
   * Device-specific provisioning hook, invoked after the VM is recreated and
   * running (transfer binaries, install units, etc.). The substrate owns the
   * destroy→recreate→start mechanics; the domain owns what "provisioned" means.
   */
  provision?: (def: VmDefinition) => Promise<void>;
  /**
   * Baseline-reseal hook, invoked after provisioning succeeds. Re-seals the
   * baseline hash into the VM so future drift checks have a current reference.
   */
  reseal?: (def: VmDefinition) => Promise<void>;
}

/**
 * Recover a corrupted VM: destroy it, recreate + start it from its registry
 * YAML, run the caller's provisioning hook, then re-seal the baseline. The
 * recreate+start goes through {@link ensureRunning} (and therefore the lock);
 * the destroy precedes it. Provisioning + reseal are caller-supplied because
 * they are domain-specific.
 */
export async function recover(vm: string | VmDefinition, opts: RecoverOpts = {}): Promise<void> {
  const def = resolve(vm);
  await destroy(def, opts);
  await ensureRunning(def, opts);
  if (opts.provision) {
    await opts.provision(def);
  }
  if (opts.reseal) {
    await opts.reseal(def);
  }
}
