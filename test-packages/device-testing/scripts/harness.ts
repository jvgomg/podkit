#!/usr/bin/env bun
/**
 * Developer-facing dispatcher for the DEVICE-SPECIFIC part of the harness VM.
 *
 * Subcommands:
 *   status   — multi-line health check: VM state, SSH, podkit/daemon/gpod-tool/unit, kernel modules
 *   install  — turbo-build podkit + dummy-hcd-daemon, transfer everything, install systemd unit
 *   setup    — first-time onboarding: ensure the VM is up, install, seal the baseline
 *
 * Generic VM lifecycle (create/start/stop/destroy/shell, for this VM and every
 * other) belongs to `podkit-vm` — the single advisory-lock chokepoint — and is
 * reachable as `bun run vm:up|vm:down|vm:destroy|vm:shell|vm:status <instance>`.
 * What stays here is what the substrate deliberately does not know: which
 * binaries and systemd unit this VM needs, and how its baseline hash is sealed.
 * `setup` therefore calls the shared `ensureRunning` (same lock as every other
 * starter) and then does the device-specific work.
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
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createVmProvisioningRunner, ensureRunning, getVm } from '@podkit/lima';

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
const DEVICE_VM = getVm('device');
const VM = LIMA_DEVICE_HARNESS_VM_NAME;

const USAGE = `Usage: bun run scripts/harness.ts <subcommand>

Subcommands:
  status            Health check: VM + binaries + systemd unit + kernel modules
  install           Build + transfer podkit, daemon, gpod-tool, systemd unit
  setup             ensure the VM is up + install + seal baseline (first-time onboarding)

Generic VM lifecycle lives in \`podkit-vm\`:
  bun run vm:up ${DEVICE_VM.id}        create/start this VM (or any registered VM)
  bun run vm:down ${DEVICE_VM.id}      stop it
  bun run vm:destroy ${DEVICE_VM.id}   delete it
  bun run vm:shell ${DEVICE_VM.id}     interactive shell

These are intended to be invoked via package.json scripts, not directly.
`;

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
    console.log(`Status: NOT READY — run \`bun run vm:up ${DEVICE_VM.id}\``);
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
      `[harness:install] Lima instance \`${VM}\` is ${status}. ` +
        `Run \`bun run vm:up ${DEVICE_VM.id}\` first.`
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
  // Create-or-start through the shared advisory lock, exactly as every other
  // starter of any VM does — a build wrapper that boots the builder VM at the
  // same moment cannot interleave with this one.
  console.log(`[harness:setup] ensuring \`${VM}\` is running...`);
  try {
    await ensureRunning(DEVICE_VM, {
      subprocess: createVmProvisioningRunner({
        // A cold create here is the longest-running thing this script does;
        // the heartbeat keeps it distinguishable from a wedge even during the
        // silent stretches of cloud-init.
        report: (line) => console.error(`[harness:setup] ${line}`),
      }),
    });
  } catch (err) {
    console.error(`[harness:setup] ${err instanceof Error ? err.message : String(err)}`);
    console.error(
      `[harness:setup] if \`${VM}\` is wedged, recreate it with: bun run vm:recover ${DEVICE_VM.id}`
    );
    return 1;
  }
  const status = await instanceStatus(VM).catch(() => 'missing' as const);
  if (status !== 'running') {
    console.error(`[harness:setup] \`${VM}\` is ${status} after ensure — cannot continue.`);
    return 1;
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
// Dispatcher
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const subcommand = process.argv[2];
  if (!subcommand) {
    process.stderr.write(USAGE);
    return 1;
  }
  switch (subcommand) {
    case 'status':
      return cmdStatus();
    case 'install':
      return cmdInstall();
    case 'setup':
      return cmdSetup();
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
