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
 *   status   <instance>   print running | stopped | missing
 *   stop     <instance>   stop the VM (no-op if missing/stopped)
 *   destroy  <instance>   delete the VM (--yes to skip the confirm prompt)
 *   recover  <instance>   destroy → recreate → start (device provisioning stays
 *                         in the device-testing harness)
 *   shell    <instance>   interactive shell inside the VM
 *   install  <instance>   ensure the VM is running (generic precondition; the
 *                         device-specific binary/unit staging lives in the
 *                         device-testing harness)
 *   doctor   <instance>   baseline-drift check for tracked VMs
 *
 * This module is a script entry point, so it prints user-facing output and sets
 * the process exit code — unlike the library modules, which stay quiet.
 *
 * @module
 */

import * as path from 'node:path';
import * as readline from 'node:readline';
import { spawnSync } from 'node:child_process';

import { getVm, listVms, type VmDefinition } from './registry.js';
import { instanceStatus } from './instance-status.js';
import { ensureRunning, stop, destroy, recover } from './lifecycle.js';
import { runInVm } from './transport.js';
import { computeBaselineHash, BASELINE_VM_HASH_PATH } from './baseline-hash.js';

const VERBS = [
  'ensure',
  'status',
  'stop',
  'destroy',
  'recover',
  'shell',
  'install',
  'doctor',
] as const;

const USAGE = `Usage: podkit-vm <verb> <instance> [--yes]

Verbs:
  ensure    Create + start the VM if needed (idempotent; shares the advisory lock)
  status    Print the VM status (running | stopped | missing)
  stop      Stop the VM (no-op if missing or already stopped)
  destroy   Delete the VM (--yes to skip the confirmation prompt)
  recover   Destroy then recreate + start the VM
  shell     Open an interactive shell inside the VM
  install   Ensure the VM is running (generic precondition for harness install)
  doctor    Baseline-drift check for tracked VMs

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

async function cmdEnsure(def: VmDefinition): Promise<number> {
  log(`[podkit-vm] ensuring \`${def.instanceName}\` is running...`);
  await ensureRunning(def);
  const status = await instanceStatus(def.instanceName);
  log(`[podkit-vm] \`${def.instanceName}\` is ${status}.`);
  return status === 'running' ? 0 : 1;
}

async function cmdStatus(def: VmDefinition): Promise<number> {
  const status = await instanceStatus(def.instanceName);
  log(status);
  return 0;
}

async function cmdStop(def: VmDefinition): Promise<number> {
  await stop(def);
  log(`[podkit-vm] \`${def.instanceName}\` stopped (or already stopped).`);
  return 0;
}

async function cmdDestroy(def: VmDefinition, args: string[]): Promise<number> {
  const yes = args.includes('--yes');
  const status = await instanceStatus(def.instanceName);
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
  await destroy(def);
  log(`[podkit-vm] \`${def.instanceName}\` deleted.`);
  return 0;
}

async function cmdRecover(def: VmDefinition): Promise<number> {
  log(`[podkit-vm] recovering \`${def.instanceName}\` (destroy → recreate → start)...`);
  await recover(def);
  const status = await instanceStatus(def.instanceName);
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

async function cmdInstall(def: VmDefinition): Promise<number> {
  // Generic precondition only: make sure the VM is up. The device-specific
  // binary/unit staging stays in the device-testing harness.
  const code = await cmdEnsure(def);
  if (code !== 0) return code;
  log(
    '[podkit-vm] VM is running. Device-specific binaries + systemd units are staged by ' +
      'the device-testing harness (`bun run harness:install`).'
  );
  return 0;
}

async function cmdDoctor(def: VmDefinition): Promise<number> {
  if (!def.trackedForBaseline) {
    log(`[podkit-vm] \`${def.instanceName}\` is not baseline-tracked. Nothing to check.`);
    return 0;
  }
  const status = await instanceStatus(def.instanceName);
  if (status !== 'running') {
    errorLog(`[podkit-vm] \`${def.instanceName}\` is ${status} — start it before doctor.`);
    return 1;
  }
  // The baseline files live in the package that owns the VM's YAML: the YAML is
  // at `<packageRoot>/lima/<instance>.yaml`, so the package root is two levels
  // up. This derives the path from the registry — no code dependency on the
  // consuming package.
  const packageRoot = path.dirname(path.dirname(def.yamlPath));
  const { combinedSha, files } = computeBaselineHash(packageRoot);
  const read = await runInVm(def.instanceName, `cat ${BASELINE_VM_HASH_PATH} 2>/dev/null || true`);
  const sealed = read.stdout.trim();
  if (!sealed) {
    errorLog(
      `[podkit-vm] no sealed baseline hash at ${BASELINE_VM_HASH_PATH} in \`${def.instanceName}\`. ` +
        'Re-seal via the device-testing harness (`bun run harness:setup`).'
    );
    return 1;
  }
  if (sealed !== combinedSha) {
    errorLog(
      `[podkit-vm] baseline DRIFT for \`${def.instanceName}\`:\n` +
        `  host   = ${combinedSha}\n` +
        `  sealed = ${sealed}\n` +
        `  tracked files: ${files.map((f) => f.relPath).join(', ')}`
    );
    return 1;
  }
  log(`[podkit-vm] baseline OK for \`${def.instanceName}\` (${combinedSha.slice(0, 12)}...).`);
  return 0;
}

async function main(): Promise<number> {
  const verb = process.argv[2];
  const instance = process.argv[3];
  const args = process.argv.slice(4);

  if (!verb || !(VERBS as readonly string[]).includes(verb)) {
    process.stderr.write(USAGE);
    return verb ? 1 : 1;
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

  switch (verb) {
    case 'ensure':
      return cmdEnsure(def);
    case 'status':
      return cmdStatus(def);
    case 'stop':
      return cmdStop(def);
    case 'destroy':
      return cmdDestroy(def, args);
    case 'recover':
      return cmdRecover(def);
    case 'shell':
      return cmdShell(def);
    case 'install':
      return cmdInstall(def);
    case 'doctor':
      return cmdDoctor(def);
    default:
      process.stderr.write(USAGE);
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    errorLog(`[podkit-vm] unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
