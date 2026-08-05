/**
 * Loopback-FAT harness for the `host-docker-image` · `loopback-fat` CLI surface.
 *
 * Runs the **shipped podkit image** as a privileged container and builds a
 * loopback FAT block device *inside* it (`losetup` + `mkfs.vfat`), mounted at a
 * path — a real block device the `podkit` CLI can operate on, with no VM. The
 * container supplies the Linux kernel `losetup`/`mkfs.vfat` need; a privileged
 * container is required for `/dev/loop-control` (proven on Docker Desktop and
 * native-Linux CI).
 *
 * The shipped alpine image ships `lsblk`/`findmnt` but NOT `mkfs.vfat`, so the
 * harness `apk add`s `dosfstools` + `util-linux` at setup. That is fixture
 * scaffolding in an ephemeral `--rm` container; it does not alter the `podkit`
 * binary under test.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runDockerCommand } from '../docker/container-manager.js';
import { containerRegistry } from '../docker/container-registry.js';
import { LABELS, generateContainerName } from '../docker/constants.js';

/** Result of running a command inside the container. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run `docker exec <id> sh -c <script>` and capture output + exit code (never throws on non-zero). */
function dockerExec(containerId: string, script: string): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('docker', ['exec', containerId, 'sh', '-c', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('close', (code) => resolvePromise({ stdout, stderr, exitCode: code ?? -1 }));
    proc.on('error', reject);
  });
}

/** A running privileged podkit container with an exec helper. */
export interface LoopbackContainer {
  id: string;
  name: string;
  exec(script: string): Promise<ExecResult>;
  stop(): Promise<void>;
}

/**
 * Start the shipped image as a long-lived privileged container.
 *
 * Overrides the entrypoint with `sleep infinity` — this is the CLI surface, so
 * the container is just a host for `docker exec podkit …`, not the daemon.
 */
export async function startLoopbackContainer(image: string): Promise<LoopbackContainer> {
  const name = generateContainerName('loopback');
  const id = (
    await runDockerCommand([
      'run',
      '-d',
      '--rm',
      '--privileged',
      '--name',
      name,
      '--label',
      LABELS.MANAGED,
      '--label',
      LABELS.source('loopback'),
      '--label',
      LABELS.startedAt(Date.now()),
      '--entrypoint',
      'sleep',
      image,
      'infinity',
    ])
  ).trim();

  containerRegistry.register(id, 'loopback', name);

  const container: LoopbackContainer = {
    id,
    name,
    exec: (script) => dockerExec(id, script),
    stop: async () => {
      // Loop devices attached inside a `--rm` container LEAK into the host/VM
      // kernel — the container's removal does not detach them, so the numbers
      // eventually exhaust and `losetup -f` picks a node that doesn't exist in a
      // fresh container. Detach the ones we created (matched by backing file) so
      // repeated runs stay clean. Best-effort; skip if the container is gone.
      try {
        await dockerExec(
          id,
          "for l in $(losetup -a 2>/dev/null | grep -E '/tmp/(ipod|generic)-[0-9]+\\.img' | cut -d: -f1); do " +
            'umount "$l" 2>/dev/null; losetup -d "$l" 2>/dev/null; done; true'
        );
      } catch {
        // Container already stopped — nothing to detach.
      }
      try {
        await runDockerCommand(['stop', id]);
      } finally {
        containerRegistry.unregister(id);
      }
    },
  };

  // Install fixture-only tools the shipped image lacks (mkfs.vfat, full losetup),
  // and pre-create loop device nodes. `losetup -f` allocates a kernel loop
  // NUMBER but does not create its `/dev/loopN` node; Docker Desktop only
  // pre-populates a handful, so a high pick (after churn) fails "device node
  // lost". Pre-creating the nodes makes any pick usable.
  //
  // Any failure past `docker run` must stop the (privileged, --rm) container so
  // it never orphans — including an exec that *rejects*, not just one that exits
  // non-zero.
  try {
    const setup = await container.exec(
      'apk add --no-cache dosfstools util-linux >/dev/null 2>&1 && ' +
        'for i in $(seq 0 63); do [ -e /dev/loop$i ] || mknod /dev/loop$i b 7 $i; done'
    );
    if (setup.exitCode !== 0) {
      throw new Error(`loopback harness: container setup failed:\n${setup.stderr}`);
    }
  } catch (err) {
    await container.stop();
    throw err;
  }

  return container;
}

/** The SysInfoExtended fixture (authoritative on-disk identity). See ./fixtures/README.md. */
const SYSINFO_EXTENDED_XML = readFileSync(
  join(import.meta.dir, 'fixtures', 'sysinfo-extended.xml'),
  'utf-8'
);

/** Classic SysInfo carrying a recognisable iPod model number (nano 3G — MB261). */
const SYSINFO_CLASSIC = 'FirewireGuid: 0x000A27001605D1A0\nModelNumStr: MB261\nBoardHwName: N/A\n';

let loopSeq = 0;

/**
 * Create a fresh loopback FAT volume and mount it at `mountPoint`, seeding an
 * iPod filesystem: `iPod_Control/Device/SysInfo` always, plus
 * `SysInfoExtended` when `withSysInfoExtended` is true.
 *
 * A FRESH device per call is deliberate: `device add` may initialise an
 * iTunesDB, and reusing a device leaks that identity into later cases.
 */
export async function seedIpodLoopback(
  container: LoopbackContainer,
  opts: { mountPoint: string; withSysInfoExtended: boolean }
): Promise<void> {
  const n = ++loopSeq;
  const img = `/tmp/ipod-${n}.img`;
  const mp = shellQuote(opts.mountPoint);
  const sieB64 = Buffer.from(SYSINFO_EXTENDED_XML, 'utf-8').toString('base64');
  const script = [
    'set -e',
    `truncate -s 64M ${img}`,
    `LOOP=$(losetup -f --show ${img})`,
    'mkfs.vfat -F 32 -n IPOD "$LOOP" >/dev/null',
    `mkdir -p ${mp}`,
    `mount "$LOOP" ${mp}`,
    `mkdir -p ${mp}/iPod_Control/Device ${mp}/iPod_Control/iTunes`,
    `printf '%s' ${shellQuote(SYSINFO_CLASSIC)} > ${mp}/iPod_Control/Device/SysInfo`,
    opts.withSysInfoExtended
      ? `printf '%s' ${shellQuote(sieB64)} | base64 -d > ${mp}/iPod_Control/Device/SysInfoExtended`
      : ':',
  ].join('\n');

  const res = await container.exec(script);
  if (res.exitCode !== 0) {
    throw new Error(`seedIpodLoopback failed (exit ${res.exitCode}):\n${res.stderr}`);
  }
}

/**
 * Create a fresh bare FAT volume with NO iPod filesystem, mounted at
 * `mountPoint` — a generic mass-storage device lacking authoritative identity.
 */
export async function seedGenericLoopback(
  container: LoopbackContainer,
  opts: { mountPoint: string }
): Promise<void> {
  const n = ++loopSeq;
  const img = `/tmp/generic-${n}.img`;
  const mp = shellQuote(opts.mountPoint);
  const script = [
    'set -e',
    `truncate -s 64M ${img}`,
    `LOOP=$(losetup -f --show ${img})`,
    'mkfs.vfat -F 32 -n USBSTICK "$LOOP" >/dev/null',
    `mkdir -p ${mp}`,
    `mount "$LOOP" ${mp}`,
  ].join('\n');

  const res = await container.exec(script);
  if (res.exitCode !== 0) {
    throw new Error(`seedGenericLoopback failed (exit ${res.exitCode}):\n${res.stderr}`);
  }
}

/** Success/error envelope from `podkit --json device add`, plus raw exec fields. */
export interface PodkitJsonResult<T = Record<string, unknown>> extends ExecResult {
  json: T | null;
}

/** Run `podkit --json <args…>` inside the container and parse the JSON envelope. */
export async function runPodkitJson<T = Record<string, unknown>>(
  container: LoopbackContainer,
  args: string[]
): Promise<PodkitJsonResult<T>> {
  const cmd = ['podkit', '--json', ...args].map(shellQuote).join(' ');
  const res = await container.exec(cmd);
  let json: T | null = null;
  try {
    json = JSON.parse(res.stdout) as T;
  } catch {
    json = null;
  }
  return { ...res, json };
}

/** Minimal POSIX single-quote shell escaping. */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}
