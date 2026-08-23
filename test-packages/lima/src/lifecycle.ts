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
      // stopped → start
      const started = await runLimactl(subprocess, ['start', def.instanceName]);
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
  const result = await runLimactl(subprocess, ['stop', def.instanceName]);
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
  const result = await runLimactl(subprocess, ['delete', '--force', def.instanceName]);
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
