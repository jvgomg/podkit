/**
 * Loopback-FAT harness for the `vm-docker-image` · `loopback-fat` CLI surface.
 *
 * Runs the **shipped podkit image** as a privileged container inside the
 * device substrate and builds a loopback FAT block device *inside* it
 * (`losetup` + `mkfs.vfat`), mounted at a path — a real block device the
 * `podkit` CLI can operate on, with no USB. The container needs `--privileged`
 * for `/dev/loop-control`, which is why this cell lives on the substrate rather
 * than a developer's host (ADR-028 §4).
 *
 * The runtime is the substrate contract's, `podman`, driven rootful. The
 * shipped alpine image ships `lsblk`/`findmnt` but NOT `mkfs.vfat`, so the
 * harness `apk add`s `dosfstools` + `util-linux` at setup. That is fixture
 * scaffolding in an ephemeral `--rm` container; it does not alter the `podkit`
 * binary under test.
 */

import {
  deviceSubstrateLink,
  ipodNano3gBlack,
  SUBSTRATE_CONTRACT_RUNTIME as LOOPBACK_RUNTIME,
  type SubstrateExecResult,
  type SubstrateLink,
} from '@podkit/device-testing';

/** Label carried by every container this harness starts, so a sweep can find them. */
const CONTAINER_LABEL = 'io.podkit.test=loopback';

/**
 * Prefix of every backing image. The substrate kernel sees container-attached
 * loop devices by this path, which is what lets a sweep detach only ours.
 */
const IMAGE_PREFIX = '/tmp/podkit-loopback-';

/** Bound for one command inside the container: a mkfs, a mount, or a `podkit` call. */
const CONTAINER_EXEC_TIMEOUT_MS = 60_000;

/**
 * Bound for starting the container and installing the fixture tools into it.
 * `apk add` fetches two small packages from the Alpine mirror.
 */
const CONTAINER_SETUP_TIMEOUT_MS = 120_000;

/** A running privileged podkit container with an exec helper. */
export interface LoopbackContainer {
  id: string;
  name: string;
  exec(script: string): Promise<SubstrateExecResult>;
  stop(): Promise<void>;
}

/**
 * Remove every container this harness started and detach every loop device
 * backed by one of its images.
 *
 * Loop devices attached inside a container outlive it: removing the container
 * unmounts the volume but leaves the device bound to its (now unreachable)
 * backing file, so the numbers eventually exhaust. The substrate is shared
 * across runs, and a run that crashed never reached its own `stop()`, so this
 * runs before a container starts as well as after it stops.
 *
 * Sweeping by label assumes one loopback run per substrate at a time — the
 * assumption every suite on a substrate makes. The run lock enforces it on a
 * remote substrate; on Lima the substrate is private to one machine.
 */
async function sweep(link: SubstrateLink): Promise<void> {
  const script = [
    `ids=$(sudo ${LOOPBACK_RUNTIME} ps -aq --filter label=${CONTAINER_LABEL})`,
    `[ -z "$ids" ] || sudo ${LOOPBACK_RUNTIME} rm -f -t 0 $ids >/dev/null`,
    `sudo losetup -l -n -O NAME,BACK-FILE | awk '$2 ~ "^${IMAGE_PREFIX}" { print $1 }' |`,
    '  while read -r dev; do sudo losetup -d "$dev"; done',
  ].join('\n');
  const result = await link.exec(script, { timeoutMs: CONTAINER_EXEC_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    throw new Error(`loopback harness: sweep failed:\n${result.stderr || result.stdout}`);
  }
}

/**
 * Fail with the remedy when the substrate predates the contract's container
 * runtime, rather than with `sudo: podman: command not found` from a build.
 */
export async function requireLoopbackRuntime(
  link: SubstrateLink = deviceSubstrateLink()
): Promise<void> {
  const probe = await link.exec(['sh', '-c', `command -v ${LOOPBACK_RUNTIME}`], {
    timeoutMs: CONTAINER_EXEC_TIMEOUT_MS,
  });
  if (probe.exitCode !== 0) {
    throw new Error(
      `${link.description} has no ${LOOPBACK_RUNTIME}, the substrate contract's container ` +
        'runtime. Re-apply the contract: `bun run harness:setup` on a Lima substrate, or ' +
        'docs/environments/device-substrate-proxmox.md §5 on a remote one.'
    );
  }
}

/**
 * Start the shipped image as a long-lived privileged container.
 *
 * Overrides the entrypoint with `sleep infinity` — this is the CLI surface, so
 * the container is just a host for `podman exec … podkit …`, not the daemon.
 */
export async function startLoopbackContainer(
  image: string,
  link: SubstrateLink = deviceSubstrateLink()
): Promise<LoopbackContainer> {
  await sweep(link);

  const name = `podkit-loopback-${Date.now()}`;
  const run = await link.exec(
    [
      'sudo',
      LOOPBACK_RUNTIME,
      'run',
      '-d',
      '--rm',
      '--privileged',
      '--name',
      name,
      '--label',
      CONTAINER_LABEL,
      '--entrypoint',
      'sleep',
      image,
      'infinity',
    ],
    { timeoutMs: CONTAINER_SETUP_TIMEOUT_MS }
  );
  if (run.exitCode !== 0) {
    throw new Error(`loopback harness: container failed to start:\n${run.stderr}`);
  }
  const id = run.stdout.trim();
  const execIn = (script: string, timeoutMs: number) =>
    link.exec(['sudo', LOOPBACK_RUNTIME, 'exec', id, 'sh', '-c', script], { timeoutMs });

  const container: LoopbackContainer = {
    id,
    name,
    exec: (script) => execIn(script, CONTAINER_EXEC_TIMEOUT_MS),
    stop: () => sweep(link),
  };

  // Install fixture-only tools the shipped image lacks (mkfs.vfat, full
  // losetup), and pre-create loop device nodes. `losetup -f` allocates a kernel
  // loop NUMBER but does not create its `/dev/loopN` node, and a container's
  // `/dev` holds only the nodes that existed when it started — so a pick past
  // them fails "device node lost". Pre-creating the nodes makes any pick usable.
  //
  // Any failure past `run` must stop the privileged container so it never
  // orphans — including an exec that *rejects*, not just one that exits
  // non-zero.
  try {
    const setup = await execIn(
      'apk add --no-cache dosfstools util-linux >/dev/null 2>&1 && ' +
        'for i in $(seq 0 63); do [ -e /dev/loop$i ] || mknod /dev/loop$i b 7 $i; done',
      CONTAINER_SETUP_TIMEOUT_MS
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

/** Authoritative on-disk identity: the nano 3G persona's captured SysInfoExtended. */
const SYSINFO_EXTENDED_XML = ipodNano3gBlack.sysInfoExtendedXml!;

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
  const img = `${IMAGE_PREFIX}ipod-${n}.img`;
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
  const img = `${IMAGE_PREFIX}generic-${n}.img`;
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
export interface PodkitJsonResult<T = Record<string, unknown>> extends SubstrateExecResult {
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
