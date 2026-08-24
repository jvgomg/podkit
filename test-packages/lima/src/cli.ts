#!/usr/bin/env bun
/**
 * `podkit-vm` — the single command-line chokepoint for Lima VM lifecycle.
 *
 * Every verb that can create or start a VM routes through the shared advisory
 * lock (via the lifecycle primitives), so TS callers, shell scripts, and this
 * CLI all funnel through ONE lock code path.
 *
 * Verbs:
 *   ensure   <instance>   create + start the VM if needed (idempotent, locked)
 *   stage    <instance>   rsync the host source tree into a VM-local directory
 *   stage-path <instance> print the VM-local path of a declared staging area
 *   status   <instance>   print running | stopped | missing
 *   stop     <instance>   stop the VM (no-op if missing/stopped)
 *   destroy  <instance>   delete the VM (--yes to skip the confirm prompt)
 *   recover  <instance>   destroy → recreate → start (device provisioning stays
 *                         in the device-testing harness)
 *   shell    <instance>   interactive shell inside the VM
 *   install  <instance>   ensure the VM is running (generic precondition; the
 *                         device-specific binary/unit staging lives in the
 *                         device-testing harness)
 *   doctor   <instance>   report whether a tracked VM carries a sealed baseline
 *                         hash (the drift comparison itself belongs to the
 *                         package that owns the VM's non-YAML inputs)
 *
 * This module is a script entry point, so it prints user-facing output and sets
 * the process exit code — unlike the library modules, which stay quiet.
 *
 * @module
 */

import * as readline from 'node:readline';
import { spawnSync } from 'node:child_process';

import { getVm, listVms, type VmDefinition } from './registry.js';
import { instanceStatus } from './instance-status.js';
import { ensureRunning, stop, destroy, recover, type LifecycleOpts } from './lifecycle.js';
import { runInVm, stageSourceTree, DEFAULT_STAGE_EXCLUDES } from './transport.js';
import { stagingDestFor } from './staging.js';
import { BASELINE_VM_HASH_PATH } from './baseline-hash.js';
import { repoRoot } from './paths.js';
import { createVmProvisioningRunner } from './streaming-runner.js';

const VERBS = [
  'ensure',
  'stage',
  'stage-path',
  'status',
  'stop',
  'destroy',
  'recover',
  'shell',
  'install',
  'doctor',
] as const;

const USAGE = `Usage: podkit-vm <verb> <instance> [options]

Verbs:
  ensure    Create + start the VM if needed (idempotent; shares the advisory lock)
  stage     rsync the host source tree into a VM-local directory
              --dest <path>     VM-local destination (required)
              --src <path>      host source root (default: the repo root)
              --exclude <glob>  extra rsync exclude, repeatable (on top of the shared set)
              --sudo            run the in-VM rsync as root
  stage-path Print the VM-local path of a declared staging area
              --area <id>       staging-area id (required)
  status    Print the VM status (running | stopped | missing)
  stop      Stop the VM (no-op if missing or already stopped)
  destroy   Delete the VM (--yes to skip the confirmation prompt)
  recover   Destroy then recreate + start the VM
  shell     Open an interactive shell inside the VM
  install   Ensure the VM is running (generic precondition for harness install)
  doctor    Report whether a tracked VM carries a sealed baseline hash

<instance> is a registry id or a Lima instance name. Known VMs:
${listVms()
  .map((vm) => `  ${vm.id} (${vm.instanceName})`)
  .join('\n')}
`;

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function errorLog(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function confirmPrompt(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(prompt, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function cmdEnsure(def: VmDefinition, opts: LifecycleOpts): Promise<number> {
  log(`[podkit-vm] ensuring \`${def.instanceName}\` is running...`);
  try {
    await ensureRunning(def, opts);
  } catch (err) {
    // A VM Lima reports as degraded reads as `stopped` here, and starting it
    // fails. Recreating it automatically would silently discard a VM the
    // operator may still want (the device VM carries provisioned state), so
    // point at the explicit verb instead of destroying anything.
    errorLog(`[podkit-vm] ${err instanceof Error ? err.message : String(err)}`);
    errorLog(
      `[podkit-vm] if \`${def.instanceName}\` is wedged, recreate it with: ` +
        `podkit-vm recover ${def.id}`
    );
    return 1;
  }
  const status = await instanceStatus(def.instanceName, opts.subprocess);
  log(`[podkit-vm] \`${def.instanceName}\` is ${status}.`);
  return status === 'running' ? 0 : 1;
}

/**
 * `stage <instance> --dest <vmDest> [--src <hostSrc>] [--exclude <glob>]... [--sudo]`
 *
 * The shell wrappers' entry into {@link stageSourceTree}. `--src` defaults to
 * the repo root, which is what every caller stages today; `--exclude` adds to
 * the shared exclude floor rather than replacing it, so a caller can only ever
 * prune MORE than the floor, never accidentally less.
 */
async function cmdStage(def: VmDefinition, args: string[], opts: LifecycleOpts): Promise<number> {
  let dest: string | undefined;
  let src: string | undefined;
  let sudo = false;
  const excludes: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dest':
        dest = args[++i];
        break;
      case '--src':
        src = args[++i];
        break;
      case '--exclude':
        {
          const pattern = args[++i];
          if (pattern === undefined) {
            errorLog('[podkit-vm] stage: --exclude requires a pattern.');
            return 1;
          }
          excludes.push(pattern);
        }
        break;
      case '--sudo':
        sudo = true;
        break;
      default:
        errorLog(`[podkit-vm] stage: unrecognised argument '${arg}'.`);
        return 1;
    }
  }

  if (!dest) {
    errorLog('[podkit-vm] stage: --dest <vm-local path> is required.');
    return 1;
  }
  const hostSrc = src ?? repoRoot();

  log(`[podkit-vm] staging ${hostSrc} → ${def.instanceName}:${dest}`);
  try {
    await stageSourceTree({
      vmName: def.instanceName,
      hostSrc,
      vmDest: dest,
      excludes,
      sudo,
      subprocess: opts.subprocess,
    });
  } catch (err) {
    errorLog(`[podkit-vm] ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  log(`[podkit-vm] staged (${DEFAULT_STAGE_EXCLUDES.length + excludes.length} excludes applied).`);
  return 0;
}

/**
 * `stage-path <instance> --area <id>`
 *
 * Print the VM-local destination a declared staging area owns, and nothing
 * else — shell wrappers capture stdout into a variable, so any decoration here
 * would end up in an rsync destination path.
 *
 * This exists so a build wrapper never spells its staging directory as a
 * literal. Two wrappers that each hard-coded the same `/tmp` path is precisely
 * how two `rsync --delete` runs ended up in one tree; routing them through the
 * area registry makes that collision a single-file, test-checkable property.
 */
function cmdStagePath(def: VmDefinition, args: string[]): number {
  let areaId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--area') {
      areaId = args[++i];
      continue;
    }
    errorLog(`[podkit-vm] stage-path: unrecognised argument '${arg}'.`);
    return 1;
  }
  if (!areaId) {
    errorLog('[podkit-vm] stage-path: --area <id> is required.');
    return 1;
  }
  try {
    log(stagingDestFor(def.instanceName, areaId));
  } catch (err) {
    errorLog(`[podkit-vm] ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  return 0;
}

async function cmdStatus(def: VmDefinition, opts: LifecycleOpts): Promise<number> {
  const status = await instanceStatus(def.instanceName, opts.subprocess);
  log(status);
  return 0;
}

async function cmdStop(def: VmDefinition, opts: LifecycleOpts): Promise<number> {
  await stop(def, opts);
  log(`[podkit-vm] \`${def.instanceName}\` stopped (or already stopped).`);
  return 0;
}

async function cmdDestroy(def: VmDefinition, args: string[], opts: LifecycleOpts): Promise<number> {
  const yes = args.includes('--yes');
  const status = await instanceStatus(def.instanceName, opts.subprocess);
  if (status === 'missing') {
    log(`[podkit-vm] \`${def.instanceName}\` does not exist. Nothing to do.`);
    return 0;
  }
  if (!yes) {
    if (!process.stdin.isTTY) {
      errorLog(
        `[podkit-vm] refusing to delete \`${def.instanceName}\` non-interactively. Pass --yes.`
      );
      return 1;
    }
    const confirmed = await confirmPrompt(
      `About to delete Lima instance \`${def.instanceName}\` (status: ${status}). Continue? [y/N] `
    );
    if (!confirmed) {
      log('[podkit-vm] aborted.');
      return 0;
    }
  }
  await destroy(def, opts);
  log(`[podkit-vm] \`${def.instanceName}\` deleted.`);
  return 0;
}

async function cmdRecover(def: VmDefinition, opts: LifecycleOpts): Promise<number> {
  log(`[podkit-vm] recovering \`${def.instanceName}\` (destroy → recreate → start)...`);
  await recover(def, opts);
  const status = await instanceStatus(def.instanceName, opts.subprocess);
  log(`[podkit-vm] \`${def.instanceName}\` is ${status}.`);
  if (def.trackedForBaseline) {
    log(
      '[podkit-vm] note: device-specific provisioning + baseline reseal are performed by ' +
        'the device-testing harness (`bun run harness:install`).'
    );
  }
  return status === 'running' ? 0 : 1;
}

function cmdShell(def: VmDefinition): number {
  const result = spawnSync('limactl', ['shell', def.instanceName], { stdio: 'inherit' });
  if (result.error) {
    errorLog(`[podkit-vm] failed to invoke limactl: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 0;
}

async function cmdInstall(def: VmDefinition, opts: LifecycleOpts): Promise<number> {
  // Generic precondition only: make sure the VM is up. The device-specific
  // binary/unit staging stays in the device-testing harness.
  const code = await cmdEnsure(def, opts);
  if (code !== 0) return code;
  log(
    '[podkit-vm] VM is running. Device-specific binaries + systemd units are staged by ' +
      'the device-testing harness (`bun run harness:install`).'
  );
  return 0;
}

async function cmdDoctor(def: VmDefinition, opts: LifecycleOpts): Promise<number> {
  if (!def.trackedForBaseline) {
    log(`[podkit-vm] \`${def.instanceName}\` is not baseline-tracked. Nothing to check.`);
    return 0;
  }
  const status = await instanceStatus(def.instanceName, opts.subprocess);
  if (status !== 'running') {
    errorLog(`[podkit-vm] \`${def.instanceName}\` is ${status} — start it before doctor.`);
    return 1;
  }
  const read = await runInVm(def.instanceName, `cat ${BASELINE_VM_HASH_PATH} 2>/dev/null || true`, {
    subprocess: opts.subprocess,
  });
  const sealed = read.stdout.trim();
  if (!sealed) {
    errorLog(
      `[podkit-vm] no sealed baseline hash at ${BASELINE_VM_HASH_PATH} in \`${def.instanceName}\`. ` +
        'Re-seal via the device-testing harness (`bun run harness:setup`).'
    );
    return 1;
  }
  // Comparing the sealed hash against the host source needs the VM's full list
  // of provisioning inputs, and that list spans packages: this package owns the
  // Lima YAML, but the rest (for the device harness, `apply-state.sh`) belongs
  // to the package that provisions the VM. Composing it here would mean a
  // second, silently-divergent copy of that list, so the comparison stays with
  // the owning package and this verb reports only what it can see for itself.
  log(
    `[podkit-vm] \`${def.instanceName}\` carries a sealed baseline hash ` +
      `(${sealed.slice(0, 12)}...).\n` +
      '[podkit-vm] Run `bun run vm:doctor` to compare it against the host sources.'
  );
  return 0;
}

/**
 * Entry point. `argv` and `opts` default to the real process argv and the real
 * `limactl`/lock so production invocation is unchanged; tests pass both
 * explicitly to dispatch against a scripted `SubprocessRunner` and a hermetic
 * lock directory without touching the real process or a real VM.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  opts: LifecycleOpts = {}
): Promise<number> {
  const verb = argv[0];
  const instance = argv[1];
  const args = argv.slice(2);

  if (!verb || !(VERBS as readonly string[]).includes(verb)) {
    process.stderr.write(USAGE);
    return 1;
  }
  if (!instance) {
    errorLog(`[podkit-vm] verb \`${verb}\` requires an <instance> argument.\n`);
    process.stderr.write(USAGE);
    return 1;
  }

  let def: VmDefinition;
  try {
    def = getVm(instance);
  } catch (err) {
    errorLog(`[podkit-vm] ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // A cold create runs for minutes; stream its provisioning log so the operator
  // can tell a slow VM from a wedged one. Probes stay buffered (see
  // `createVmProvisioningRunner`). Tests inject their own runner and are
  // unaffected.
  const resolved: LifecycleOpts = {
    ...opts,
    subprocess: opts.subprocess ?? createVmProvisioningRunner(),
  };

  switch (verb) {
    case 'ensure':
      return cmdEnsure(def, resolved);
    case 'stage':
      return cmdStage(def, args, resolved);
    case 'stage-path':
      return cmdStagePath(def, args);
    case 'status':
      return cmdStatus(def, resolved);
    case 'stop':
      return cmdStop(def, resolved);
    case 'destroy':
      return cmdDestroy(def, args, resolved);
    case 'recover':
      return cmdRecover(def, resolved);
    case 'shell':
      return cmdShell(def);
    case 'install':
      return cmdInstall(def, resolved);
    case 'doctor':
      return cmdDoctor(def, resolved);
    default:
      process.stderr.write(USAGE);
      return 1;
  }
}

// Script entry point: only run (and exit the process) when this module is
// executed directly, not when imported — e.g. by unit tests.
if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      errorLog(`[podkit-vm] unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
