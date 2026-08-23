#!/usr/bin/env bun
/**
 * Developer-facing dispatcher for the device-harness Lima VM lifecycle.
 *
 * Subcommands:
 *   create   — `limactl create --name <vm> <yaml>` (idempotent: no-op if instance exists)
 *   start    — `limactl start <vm>` (errors with a hint if the instance is missing)
 *   stop     — `limactl stop <vm>` (silent no-op if absent or already stopped)
 *   destroy  — `limactl delete --force <vm>` (interactive confirm unless --yes)
 *   shell    — interactive `limactl shell <vm>` (stdio inherited)
 *   status   — multi-line health check: VM state, SSH, podkit/daemon/gpod-tool/unit, kernel modules
 *   install  — turbo-build podkit + dummy-hcd-daemon, transfer everything, install systemd unit
 *   setup    — first-time onboarding: create + start + install + status
 *
 * Intended invocation is via the `harness:*` package.json scripts (which are
 * mirrored at the repo root), not direct. The repo-root aliases let a
 * developer type `bun run harness:setup` from anywhere in the tree.
 *
 * @see test-packages/lima/vms/podkit-device.yaml
 * @see agents/device-testing.md
 * @module
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { getVm } from '@podkit/lima';

import { runLimactl } from '../src/runners/lima-limactl.js';
import { defaultSubprocessRunner } from '../src/subprocess.js';
import {
  computeBaselineHash,
  deviceBaselineFiles,
  BASELINE_VM_HASH_PATH,
} from '../src/baseline-hash.js';
import {
  instanceStatus,
  LIMA_DEVICE_HARNESS_VM_NAME,
  DEFAULT_DUMMY_HCD_DAEMON_VM_PATH,
  resolveDefaultPodkitBinary,
  resolveDefaultPodkitDebugBinary,
  resolveDefaultDummyHcdDaemonBinary,
  resolveDefaultGpodToolBinary,
} from '../src/runners/lima-test-vm.js';
import {
  transferBinary,
  transferGpodTool,
  DEFAULT_PODKIT_VM_PATH,
  DEFAULT_PODKIT_DEBUG_VM_PATH,
  DEFAULT_GPOD_TOOL_VM_PATH,
} from '../src/runners/lima-test-vm-binary.js';
import {
  transferSystemdUnit,
  resolveDefaultDummyHcdDaemonUnit,
  DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH,
} from '../src/runners/lima-test-vm-systemd.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const VM = LIMA_DEVICE_HARNESS_VM_NAME;
const VM_YAML = getVm('device').yamlPath;
const VM_YAML_REL = path.relative(REPO_ROOT, VM_YAML);

// The builder VM is a separate Lima instance that cross-compiles Linux
// binaries on macOS hosts (libgpod-node prebuilds + podkit standalone +
// dummy-hcd-daemon). The build-linux-*.sh scripts auto-create + auto-start
// it on demand, so a developer rarely needs to touch it directly. The
// `builder:stop` / `builder:destroy` subcommands exist as escape hatches
// (free RAM, force a clean rebuild).
const BUILDER_VM = getVm('builderGlibc').instanceName;

const USAGE = `Usage: bun run scripts/harness.ts <subcommand>

Subcommands:
  create            Create the Lima VM (idempotent)
  start             Start (or resume) the VM
  stop              Stop the VM (preserves state)
  destroy           Delete the VM (--yes to skip the confirm prompt)
  shell             Interactive shell inside the VM
  status            Health check: VM + binaries + systemd unit + kernel modules
  install           Build + transfer podkit, daemon, gpod-tool, systemd unit
  setup             create + start + install + status (first-time onboarding)
  builder:stop      Stop the Linux-builder VM (rarely needed — auto-managed by build scripts)
  builder:destroy   Delete the Linux-builder VM (--yes to skip the confirm prompt)

These are intended to be invoked via package.json scripts, not directly.
`;

// ---------------------------------------------------------------------------
// Subcommand: create
// ---------------------------------------------------------------------------

async function cmdCreate(): Promise<number> {
  const status = await instanceStatus(VM).catch(() => 'missing' as const);
  if (status !== 'missing') {
    console.log(
      `[harness:create] Lima instance \`${VM}\` already exists (status: ${status}). Nothing to do.`
    );
    return 0;
  }
  // Use spawnSync so the user sees Lima's provisioning output directly (the
  // runLimactl helper buffers stdout/stderr). `--tty=false` accepts the config
  // as-is instead of dropping into Lima's interactive config-editor prompt.
  const result = spawnSync('limactl', ['create', '--tty=false', '--name', VM, VM_YAML_REL], {
    stdio: 'inherit',
    cwd: REPO_ROOT,
  });
  if (result.error) {
    console.error(`[harness:create] failed to invoke limactl: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// Subcommand: start
// ---------------------------------------------------------------------------

async function cmdStart(): Promise<number> {
  const status = await instanceStatus(VM).catch(() => 'missing' as const);
  if (status === 'missing') {
    console.error(
      `[harness:start] Lima instance \`${VM}\` does not exist. Run \`bun run harness:create\` first.`
    );
    return 1;
  }
  if (status === 'running') {
    console.log(
      `[harness:start] Lima instance \`${VM}\` is already running. Use \`bun run harness:status\` to inspect.`
    );
    return 0;
  }
  const result = spawnSync('limactl', ['start', VM], { stdio: 'inherit' });
  if (result.error) {
    console.error(`[harness:start] failed to invoke limactl: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// Subcommand: stop
// ---------------------------------------------------------------------------

async function cmdStop(): Promise<number> {
  const status = await instanceStatus(VM).catch(() => 'missing' as const);
  if (status === 'missing' || status === 'stopped') {
    // Silent no-op per brief.
    return 0;
  }
  const result = spawnSync('limactl', ['stop', VM], { stdio: 'inherit' });
  if (result.error) {
    console.error(`[harness:stop] failed to invoke limactl: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// Subcommand: destroy
// ---------------------------------------------------------------------------

async function cmdDestroy(args: string[]): Promise<number> {
  const yes = args.includes('--yes');
  const status = await instanceStatus(VM).catch(() => 'missing' as const);
  if (status === 'missing') {
    console.log(`[harness:destroy] Lima instance \`${VM}\` does not exist. Nothing to do.`);
    return 0;
  }
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error(
        `[harness:destroy] refusing to delete \`${VM}\` non-interactively. Pass --yes to confirm.`
      );
      return 1;
    }
    const confirmed = await confirmPrompt(
      `About to delete Lima instance \`${VM}\` (current status: ${status}). Continue? [y/N] `
    );
    if (!confirmed) {
      console.log('[harness:destroy] aborted.');
      return 0;
    }
  }
  const result = spawnSync('limactl', ['delete', '--force', VM], { stdio: 'inherit' });
  if (result.error) {
    console.error(`[harness:destroy] failed to invoke limactl: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
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

// ---------------------------------------------------------------------------
// Subcommand: shell
// ---------------------------------------------------------------------------

async function cmdShell(): Promise<number> {
  const status = await instanceStatus(VM).catch(() => 'missing' as const);
  if (status === 'missing') {
    console.error(
      `[harness:shell] Lima instance \`${VM}\` does not exist. Run \`bun run harness:create\` first.`
    );
    return 1;
  }
  if (status === 'stopped') {
    console.error(
      `[harness:shell] Lima instance \`${VM}\` is stopped. Run \`bun run harness:start\` first.`
    );
    return 1;
  }
  // Inherit stdio so the developer gets a real interactive shell.
  const result = spawnSync('limactl', ['shell', VM], { stdio: 'inherit' });
  if (result.error) {
    console.error(`[harness:shell] failed to invoke limactl: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 0;
}

// ---------------------------------------------------------------------------
// Subcommand: status
// ---------------------------------------------------------------------------

interface StatusLine {
  ok: boolean;
  label: string;
  detail?: string;
}

function fmtLine(line: StatusLine): string {
  const glyph = line.ok ? '✓' : '✗';
  const tail = line.detail ? ` — ${line.detail}` : '';
  return `  ${glyph} ${line.label}${tail}`;
}

async function probeVmFileExists(vmPath: string): Promise<boolean> {
  const probe = await runLimactl(defaultSubprocessRunner, [
    'shell',
    VM,
    '--',
    'sh',
    '-c',
    `test -e ${shellQuote(vmPath)}`,
  ]).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }));
  return probe.exitCode === 0;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function cmdStatus(): Promise<number> {
  const lines: StatusLine[] = [];
  const status = await instanceStatus(VM).catch(() => 'missing' as const);

  console.log(`[harness:status] Lima instance \`${VM}\`:`);
  if (status === 'missing') {
    lines.push({ ok: false, label: 'VM state', detail: 'missing (instance not registered)' });
    console.log(lines.map(fmtLine).join('\n'));
    console.log('');
    console.log('Status: NOT READY — run `bun run harness:setup`');
    return 0;
  }
  lines.push({ ok: status === 'running', label: 'VM state', detail: status });

  if (status !== 'running') {
    console.log(lines.map(fmtLine).join('\n'));
    console.log('');
    console.log('Status: NOT READY — run `bun run harness:start`');
    return 0;
  }

  // SSH probe — limactl shell <vm> -- /bin/true.
  const sshProbe = await runLimactl(defaultSubprocessRunner, [
    'shell',
    VM,
    '--',
    '/bin/true',
  ]).catch((err) => ({ exitCode: 1, stdout: '', stderr: String(err) }));
  const sshOk = sshProbe.exitCode === 0;
  lines.push({
    ok: sshOk,
    label: 'SSH reachable',
    detail: sshOk ? 'limactl shell answers' : `refused: ${sshProbe.stderr.trim() || 'no stderr'}`,
  });

  if (!sshOk) {
    console.log(lines.map(fmtLine).join('\n'));
    console.log('');
    console.log('Status: NOT READY — SSH refused (boot still in progress?)');
    return 0;
  }

  // Per-binary presence probes.
  const podkitOk = await probeVmFileExists(DEFAULT_PODKIT_VM_PATH);
  lines.push({
    ok: podkitOk,
    label: `podkit binary (${DEFAULT_PODKIT_VM_PATH})`,
    detail: podkitOk ? 'present' : 'missing',
  });

  const daemonOk = await probeVmFileExists(DEFAULT_DUMMY_HCD_DAEMON_VM_PATH);
  lines.push({
    ok: daemonOk,
    label: `dummy-hcd-daemon (${DEFAULT_DUMMY_HCD_DAEMON_VM_PATH})`,
    detail: daemonOk ? 'present' : 'missing',
  });

  const gpodOk = await probeVmFileExists(DEFAULT_GPOD_TOOL_VM_PATH);
  lines.push({
    ok: gpodOk,
    label: `gpod-tool (${DEFAULT_GPOD_TOOL_VM_PATH})`,
    detail: gpodOk ? 'present' : 'MISSING — run `bun run harness:install`',
  });

  const unitOk = await probeVmFileExists(DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH);
  lines.push({
    ok: unitOk,
    label: `systemd unit (${DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH})`,
    detail: unitOk ? 'present' : 'missing',
  });

  // Kernel modules — single lsmod probe.
  const lsmod = await runLimactl(defaultSubprocessRunner, [
    'shell',
    VM,
    '--',
    'sh',
    '-c',
    'lsmod | grep -E "dummy_hcd|libcomposite|usb_f_mass_storage|usb_f_fs" || true',
  ]).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }));
  const moduleNames = ['dummy_hcd', 'libcomposite', 'usb_f_mass_storage', 'usb_f_fs'];
  const loaded = new Set(
    lsmod.stdout
      .split('\n')
      .map((l) => l.split(/\s+/)[0])
      .filter((n) => n && moduleNames.includes(n))
  );
  for (const mod of moduleNames) {
    const ok = loaded.has(mod);
    lines.push({
      ok,
      label: `kernel module ${mod}`,
      detail: ok ? 'loaded' : 'NOT loaded',
    });
  }

  console.log(lines.map(fmtLine).join('\n'));
  console.log('');

  // Required-for-ready: podkit + daemon + gpod-tool + unit + all kernel
  // modules. gpod-tool is now a required harness dependency (tests assume
  // it is present inside the VM).
  const requiredOk =
    podkitOk && daemonOk && gpodOk && unitOk && moduleNames.every((m) => loaded.has(m));
  if (requiredOk) {
    console.log('Status: ready for `bun run test:vm`');
  } else {
    console.log('Status: NOT READY — run `bun run harness:install`');
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: install
// ---------------------------------------------------------------------------

async function cmdInstall(): Promise<number> {
  const status = await instanceStatus(VM).catch(() => 'missing' as const);
  if (status !== 'running') {
    console.error(
      `[harness:install] Lima instance \`${VM}\` is ${status}. Run \`bun run harness:start\` first.`
    );
    return 1;
  }

  // 1. Turbo build. PODKIT_HOST_ARCH is hashed into the turbo cache key so a
  //    shared cache from a different-arch host cannot deliver wrong-arch
  //    binaries. Set it from process.arch (`arm64` → `arm64`, anything else
  //    → `x86_64` — `uname -m` convention).
  process.env['PODKIT_HOST_ARCH'] = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  console.log('[harness:install] building linux binaries via turbo...');
  const turboResult = spawnSync(
    'bunx',
    [
      'turbo',
      'run',
      '@podkit/device-testing#build:linux-binary',
      '@podkit/device-testing-daemon#build',
      '@podkit/gpod-testing#build:linux-binary',
    ],
    { stdio: 'inherit', cwd: REPO_ROOT, env: process.env }
  );
  if (turboResult.error) {
    console.error(`[harness:install] failed to invoke bunx turbo: ${turboResult.error.message}`);
    return 1;
  }
  if ((turboResult.status ?? 1) !== 0) {
    console.error('[harness:install] turbo build failed — see output above.');
    return 1;
  }

  // 2. Podkit binary — fatal if missing on host.
  const podkitPath = resolveDefaultPodkitBinary();
  if (!fs.existsSync(podkitPath)) {
    console.error(
      `[harness:install] podkit linux binary not found at ${podkitPath}. Turbo claimed success but the artefact is missing.`
    );
    return 1;
  }
  console.log(`[harness:install] transferring podkit binary → ${VM}:${DEFAULT_PODKIT_VM_PATH}`);
  const podkitResult = await transferBinary({ vmName: VM, binaryPath: podkitPath });
  console.log(
    podkitResult.skipped
      ? `  skipped — sha256 matches (${podkitResult.hostSha256.slice(0, 12)}...)`
      : `  installed (sha256=${podkitResult.hostSha256.slice(0, 12)}...)`
  );

  // 2b. podkit-debug binary — best-effort. Ships side-by-side with the
  //     production binary for e2e tests that need devPause(key) (see
  //     documents/architecture/dev-builds.md). Treat as optional so
  //     older builders that don't yet produce it stay usable.
  const podkitDebugPath = resolveDefaultPodkitDebugBinary();
  if (fs.existsSync(podkitDebugPath)) {
    console.log(
      `[harness:install] transferring podkit-debug binary → ${VM}:${DEFAULT_PODKIT_DEBUG_VM_PATH}`
    );
    const podkitDebugResult = await transferBinary({
      vmName: VM,
      binaryPath: podkitDebugPath,
      vmPath: DEFAULT_PODKIT_DEBUG_VM_PATH,
    });
    console.log(
      podkitDebugResult.skipped
        ? `  skipped — sha256 matches (${podkitDebugResult.hostSha256.slice(0, 12)}...)`
        : `  installed (sha256=${podkitDebugResult.hostSha256.slice(0, 12)}...)`
    );
  } else {
    console.log(
      `[harness:install] podkit-debug binary missing at ${podkitDebugPath} — skipping ` +
        '(rebuild via `bunx turbo run @podkit/device-testing#build:linux-binary --force`).'
    );
  }

  // 3. dummy-hcd-daemon — also fatal if missing (the build step claimed
  //    success so the binary should be on disk).
  const daemonPath = resolveDefaultDummyHcdDaemonBinary();
  if (!fs.existsSync(daemonPath)) {
    console.error(
      `[harness:install] dummy-hcd-daemon binary not found at ${daemonPath}. Turbo claimed success but the artefact is missing.`
    );
    return 1;
  }
  console.log(
    `[harness:install] transferring dummy-hcd-daemon → ${VM}:${DEFAULT_DUMMY_HCD_DAEMON_VM_PATH}`
  );
  const daemonResult = await transferBinary({
    vmName: VM,
    binaryPath: daemonPath,
    vmPath: DEFAULT_DUMMY_HCD_DAEMON_VM_PATH,
  });
  console.log(
    daemonResult.skipped
      ? `  skipped — sha256 matches (${daemonResult.hostSha256.slice(0, 12)}...)`
      : `  installed (sha256=${daemonResult.hostSha256.slice(0, 12)}...)`
  );

  // 4. gpod-tool — REQUIRED. The turbo step above built a fresh Linux
  //    binary; treat a missing artefact the same way we treat podkit.
  const gpodToolPath = resolveDefaultGpodToolBinary();
  if (!fs.existsSync(gpodToolPath)) {
    console.error(
      `[harness:install] gpod-tool linux binary not found at ${gpodToolPath}. Turbo claimed success but the artefact is missing.`
    );
    return 1;
  }
  console.log(`[harness:install] transferring gpod-tool → ${VM}:${DEFAULT_GPOD_TOOL_VM_PATH}`);
  const gpodResult = await transferGpodTool({ vmName: VM, binaryPath: gpodToolPath });
  console.log(
    gpodResult.skipped
      ? `  skipped — sha256 matches (${gpodResult.hostSha256.slice(0, 12)}...)`
      : `  installed (sha256=${gpodResult.hostSha256.slice(0, 12)}...)`
  );

  // 5. systemd unit — always run; helper sha256-skips when already current.
  console.log(
    `[harness:install] installing systemd unit → ${VM}:${DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH}`
  );
  const unitResult = await transferSystemdUnit({
    vmName: VM,
    hostUnitPath: resolveDefaultDummyHcdDaemonUnit(),
  });
  console.log(
    unitResult.skipped
      ? `  skipped — sha256 matches (${unitResult.hostSha256.slice(0, 12)}...)`
      : `  installed (sha256=${unitResult.hostSha256.slice(0, 12)}...)${unitResult.reloaded ? ', daemon-reload issued' : ''}`
  );

  console.log('');
  console.log('[harness:install] all binaries + unit installed.');
  console.log('');
  return cmdStatus();
}

// ---------------------------------------------------------------------------
// Subcommand: setup
// ---------------------------------------------------------------------------

async function cmdSetup(): Promise<number> {
  let status = await instanceStatus(VM).catch(() => 'missing' as const);
  if (status === 'missing') {
    console.log('[harness:setup] VM missing — creating...');
    const code = await cmdCreate();
    if (code !== 0) return code;
    // After `limactl create`, the VM is typically not started yet.
    status = await instanceStatus(VM).catch(() => 'missing' as const);
  }
  if (status === 'stopped' || status === 'missing') {
    // `missing` here would be surprising (create just succeeded) but handle
    // it for completeness — cmdStart will surface the error message.
    console.log('[harness:setup] starting VM...');
    const code = await cmdStart();
    if (code !== 0) return code;
  }
  console.log('[harness:setup] installing binaries + systemd unit...');
  const installCode = await cmdInstall();
  if (installCode !== 0) return installCode;

  // Seal the baseline hash AFTER install so vm:doctor has a current
  // reference. Drift between this hash and the host-side recomputation
  // is the signal vm:doctor uses to error future test:vm runs.
  const sealCode = await sealBaselineHash();
  if (sealCode !== 0) return sealCode;
  // cmdInstall already runs cmdStatus at the end. No need to repeat.
  return 0;
}

async function sealBaselineHash(): Promise<number> {
  const { combinedSha, files } = computeBaselineHash(deviceBaselineFiles());
  console.log(
    `[harness:setup] sealing baseline hash (${combinedSha.slice(0, 12)}...; ${files.length} files)`
  );
  // `install -D -m 0644 /dev/stdin ${BASELINE_VM_HASH_PATH}` would be the
  // POSIX-pure form, but limactl shell over ssh doesn't reliably forward
  // stdin to a remote `install` invocation. printf into a /tmp file then
  // sudo install is the same shape as the persona sidecar emission.
  const mkdirResult = spawnSync(
    'limactl',
    [
      'shell',
      VM,
      '--',
      'sudo',
      'install',
      '-d',
      '-m',
      '0755',
      path.posix.dirname(BASELINE_VM_HASH_PATH),
    ],
    { stdio: 'inherit' }
  );
  if ((mkdirResult.status ?? 1) !== 0) {
    console.error('[harness:setup] failed to mkdir baseline-hash parent');
    return 1;
  }

  const writeResult = spawnSync(
    'limactl',
    [
      'shell',
      VM,
      '--',
      'sh',
      '-c',
      `echo ${combinedSha} | sudo tee ${BASELINE_VM_HASH_PATH} >/dev/null`,
    ],
    { stdio: 'inherit' }
  );
  if ((writeResult.status ?? 1) !== 0) {
    console.error(`[harness:setup] failed to write baseline-hash to ${BASELINE_VM_HASH_PATH}`);
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: builder:stop
// ---------------------------------------------------------------------------

async function cmdBuilderStop(): Promise<number> {
  const status = await instanceStatus(BUILDER_VM).catch(() => 'missing' as const);
  if (status === 'missing') {
    console.log(`[harness:builder:stop] no \`${BUILDER_VM}\` instance — nothing to do.`);
    return 0;
  }
  if (status === 'stopped') {
    console.log(`[harness:builder:stop] \`${BUILDER_VM}\` is already stopped.`);
    return 0;
  }
  const result = spawnSync('limactl', ['stop', BUILDER_VM], { stdio: 'inherit' });
  if (result.error) {
    console.error(`[harness:builder:stop] failed to invoke limactl: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// Subcommand: builder:destroy
// ---------------------------------------------------------------------------

async function cmdBuilderDestroy(args: string[]): Promise<number> {
  const status = await instanceStatus(BUILDER_VM).catch(() => 'missing' as const);
  if (status === 'missing') {
    console.log(`[harness:builder:destroy] no \`${BUILDER_VM}\` instance — nothing to do.`);
    return 0;
  }
  const yes = args.includes('--yes');
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error(
        `[harness:builder:destroy] refusing to delete \`${BUILDER_VM}\` non-interactively. ` +
          'Pass --yes to confirm.'
      );
      return 1;
    }
    const confirmed = await confirmPrompt(
      `About to delete Lima instance \`${BUILDER_VM}\` (current status: ${status}). The next build will re-create it (5–10 min first run). Continue? [y/N] `
    );
    if (!confirmed) {
      console.log('[harness:builder:destroy] aborted.');
      return 0;
    }
  }
  const result = spawnSync('limactl', ['delete', '--force', BUILDER_VM], { stdio: 'inherit' });
  if (result.error) {
    console.error(`[harness:builder:destroy] failed to invoke limactl: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const subcommand = process.argv[2];
  const args = process.argv.slice(3);
  if (!subcommand) {
    process.stderr.write(USAGE);
    return 1;
  }
  switch (subcommand) {
    case 'create':
      return cmdCreate();
    case 'start':
      return cmdStart();
    case 'stop':
      return cmdStop();
    case 'destroy':
      return cmdDestroy(args);
    case 'shell':
      return cmdShell();
    case 'status':
      return cmdStatus();
    case 'install':
      return cmdInstall();
    case 'setup':
      return cmdSetup();
    case 'builder:stop':
      return cmdBuilderStop();
    case 'builder:destroy':
      return cmdBuilderDestroy(args);
    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n\n${USAGE}`);
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[harness] unexpected error: ${msg}`);
    process.exit(1);
  });
