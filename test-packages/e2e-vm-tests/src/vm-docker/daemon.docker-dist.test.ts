/**
 * E2E · vm-docker-image · usb-synth — the BUNDLED daemon driving a steady-state sync of a
 * synthesized USB iPod inside the device-harness Lima VM, through the shipped
 * musl image.
 *
 * The sibling `image.docker-dist.test.ts` proves the shipped image via one-shot
 * `podkit sync`. This file proves the OTHER thing the image bundles: the
 * `podkit-daemon` binary, run as a long-lived container process, detecting a
 * connected iPod and auto-syncing it — real FLAC→AAC tracks landing on the
 * device — with zero per-sync operator action. That is "daemon steady state":
 * the container is up, an iPod is present, and tracks flow onto it on the poll
 * interval.
 *
 * # The daemon's two detection lanes — BOTH proven here
 *
 * The daemon shells out to the podkit CLI to sync (it never loads config or
 * mounts in-process). It has TWO detection lanes (`packages/podkit-daemon`), and
 * this file proves each end-to-end through the image with its own `describe`:
 *
 *   Mass-storage lane (path scan) — polls each `PODKIT_MASS_STORAGE_PATHS`
 *   entry, treats a present directory as an already-mounted device, and syncs it
 *   by that path with a no-op mount/eject. Driven here by bind-mounting a
 *   persona's FAT at `/ipod` and setting `PODKIT_MASS_STORAGE_PATHS=/ipod`. This
 *   is the "bind-mount a volume into the container" story, and it is
 *   in-container-safe by construction (syncs by the bind-mount path — no
 *   `volumeUuid` resolution, which fails in-container: DEVICE_PATH_UNRESOLVED).
 *
 *   iPod lane (lsblk) — the PRIMARY "plug a real iPod into the container host"
 *   path: polls `lsblk`, keeps FAT volumes whose base disk carries the Apple USB
 *   vendor id in `/sys`, then `podkit mount`s the RAW block node inside the
 *   container and syncs by the resulting mount path. Driven here against a
 *   MBR-partitioned persona (`ipod5gVideoMbrPart`) with `--privileged`. Two
 *   things this lane needs that the mass-storage lane does not:
 *
 *     - `--privileged`: the daemon mounts the block node in-container, and the
 *       default container profile filters the mount syscall even for root
 *       (`--device` + `SYS_ADMIN` are NOT enough). The lsblk-lane `it` asserts
 *       this requirement so a regression is caught.
 *     - a PARTITIONED persona: the daemon poller detects both a whole-disk FAT
 *       (`type: "disk"`) and a partition (`type: "part"`). A real MBR/FAT32 iPod
 *       presents a `part`; the dedicated `ipod5gVideoMbrPart` persona synthesises
 *       that shape (MBR + FAT32 `sd?1`) so the common real-hardware case is what
 *       gets exercised, rather than the whole-disk shortcut the mass-storage
 *       persona uses.
 *
 * # SIGTERM graceful-drain + Apprise (orchestrator behaviors)
 *
 * A third `describe` proves the daemon's shutdown + notification paths on the
 * iPod lsblk lane: a 60-track sync interrupted mid-flight by SIGTERM drains
 * gracefully (SIGINT forwarded to the CLI child, container exits 0, the
 * checkpointed completed tracks survive), and a completed sync delivers a
 * "sync complete" Apprise notification to a mock endpoint on the VM host
 * (reached via `--network host`).
 *
 * # Detached-container lifecycle (the new part vs. the one-shot sibling)
 *
 * The daemon is long-lived, so it runs DETACHED (`nerdctl run -d`) and its
 * lifecycle is managed explicitly: start it, POLL for the sync to land (grep the
 * container logs for the per-device completion marker via `waitForDaemonSync`,
 * capped generously since the poll interval is 2s and a two-track sync takes
 * ~1s), then read the tracks back via a one-shot container. Teardown STOPS +
 * REMOVES the detached container in `afterAll` AND on any mid-setup throw,
 * best-effort — a leaked `-d` container would break the next run (name clash +
 * a stale mount reference). The two lanes use distinct container names so their
 * lifecycles never collide.
 *
 * # Shared setup with the sibling
 *
 * The device seeding (gpod-tool init the empty FAT, generate FLACs, write a
 * config) mirrors the sibling. The shell/JSON container helpers are shared via
 * `./container-helpers`. The two lanes' seeding is kept inline (per `describe`)
 * because they differ in device shape (whole-disk vs. partition), addressing
 * (bind-mount path vs. auto-mounted node), and privilege — abstracting across
 * them would obscure more than it saves.
 *
 * @see test-packages/e2e-vm-tests/src/vm-docker/image.docker-dist.test.ts (the one-shot CLI sibling)
 * @see packages/podkit-daemon/src/device-poller.ts (the two detection lanes)
 * @see agents/docker.md ("Running the vm-docker-image e2e locally")
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  DEFAULT_PODKIT_IMAGE_TAG,
  ensurePodkitImageInVm,
  mountPersona,
  unmountAndStop,
  resolvePersonaDeviceNodes,
  healthy,
  ipodVideo5gIflash1tb,
  ipod5gVideoMbrPart,
} from '@podkit/device-testing';

import { sq, runContainerJson, assertContainerOk } from './container-helpers.js';

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** The in-VM image build can take several minutes; wide `beforeAll` budget. */
const IMAGE_BUILD_TIMEOUT_MS = 600_000;

/** A one-shot container step (read-back, version probe). */
const CONTAINER_STEP_TIMEOUT_MS = 180_000;

/**
 * The detached daemon flow: start the container, wait (poll) for it to detect +
 * sync, then read back. The wait dominates, so the whole `it` gets a generous
 * budget covering the start, the poll loop, and the read-back.
 */
const DAEMON_FLOW_TIMEOUT_MS = 240_000;

/**
 * Cap for the "daemon has synced" poll loop. The poll interval is 2s and a
 * two-track sync takes ~1s, so a completed sync lands within a few seconds; this
 * cap is deliberately generous to absorb container start + ffmpeg cold start on
 * a loaded CI VM. On timeout we dump the container logs so a real failure is
 * diagnosable rather than a bare "timed out".
 */
const SYNC_WAIT_TIMEOUT_MS = 90_000;
const SYNC_WAIT_POLL_MS = 2_000;

// ---------------------------------------------------------------------------
// Detached daemon container names. Fixed names let teardown remove them
// unconditionally; each flow removes any pre-existing container of its name
// before starting so a leaked container from a crashed prior run can't clash.
// The two lanes use distinct names so their lifecycles never collide.
// ---------------------------------------------------------------------------
/** Mass-storage lane (bind-mounted `/ipod`, whole-disk persona). */
const MASS_STORAGE_DAEMON_CONTAINER = 'podkit-daemon-dockerdist';
/** iPod lsblk lane (raw block passthrough, MBR-partitioned persona). */
const LSBLK_DAEMON_CONTAINER = 'podkit-daemon-dockerdist-lsblk';
/** SIGTERM-drain + Apprise lane (mass-storage vehicle, own container name). */
const DRAIN_DAEMON_CONTAINER = 'podkit-daemon-dockerdist-drain';

// ---------------------------------------------------------------------------
// Mock Apprise endpoint (AC3). A tiny python3 HTTP server on the VM HOST that
// appends every POST body to a capture file and replies 200. The daemon
// container reaches it via `--network host` + PODKIT_APPRISE_URL=127.0.0.1.
// ---------------------------------------------------------------------------
const APPRISE_PORT = 8477;
const APPRISE_CAPTURE = '/tmp/podkit-daemon-apprise.log';
const APPRISE_MOCK = '/tmp/podkit-daemon-apprise-mock.py';
const APPRISE_MOCK_PY = [
  'from http.server import BaseHTTPRequestHandler, HTTPServer',
  'class H(BaseHTTPRequestHandler):',
  '    def do_POST(self):',
  '        n=int(self.headers.get("Content-Length",0)); b=self.rfile.read(n)',
  `        open(${JSON.stringify(APPRISE_CAPTURE)},"ab").write(b+b"\\n")`,
  '        self.send_response(200); self.end_headers()',
  '    def log_message(self,*a): pass',
  `HTTPServer(("127.0.0.1", ${APPRISE_PORT}), H).serve_forever()`,
  '',
].join('\n');

async function startMockApprise(): Promise<void> {
  await limaTestVmRunner.run(`printf '%s' ${sq(APPRISE_MOCK_PY)} > ${APPRISE_MOCK}`, {
    timeoutMs: VM_WARM_TIMEOUT_MS,
  });
  await limaTestVmRunner.run(`pkill -f ${APPRISE_MOCK} 2>/dev/null || true`, {
    timeoutMs: VM_WARM_TIMEOUT_MS,
  });
  // `setsid` detaches the server into its OWN session so it survives after this
  // run()'s SSH session closes — a plain backgrounded job is torn down with the
  // session (which is why a combined one-liner left nothing listening).
  await limaTestVmRunner.run(`setsid python3 ${APPRISE_MOCK} >/dev/null 2>&1 < /dev/null &`, {
    timeoutMs: VM_WARM_TIMEOUT_MS,
  });
  await limaTestVmRunner.run('sleep 1', { timeoutMs: VM_WARM_TIMEOUT_MS });
}

async function stopMockApprise(): Promise<void> {
  await limaTestVmRunner
    .run(`pkill -f ${APPRISE_MOCK} 2>/dev/null || true`, { timeoutMs: VM_WARM_TIMEOUT_MS })
    .catch(() => {});
}

async function readAppriseCapture(): Promise<string> {
  const r = await limaTestVmRunner.run(`cat ${APPRISE_CAPTURE} 2>/dev/null || echo __NONE__`, {
    timeoutMs: VM_WARM_TIMEOUT_MS,
  });
  return r.stdout;
}

/** Poll a detached container's logs until `pattern` appears or the budget runs out. */
async function waitForDaemonLog(
  containerName: string,
  pattern: RegExp
): Promise<{ matched: boolean; logs: string }> {
  const deadline = Date.now() + SYNC_WAIT_TIMEOUT_MS;
  let logs = '';
  while (Date.now() < deadline) {
    logs = (
      await limaTestVmRunner.run(`sudo nerdctl logs ${containerName} 2>&1`, {
        timeoutMs: VM_WARM_TIMEOUT_MS,
      })
    ).stdout;
    if (pattern.test(logs)) return { matched: true, logs };
    await new Promise((r) => setTimeout(r, SYNC_WAIT_POLL_MS));
  }
  return { matched: false, logs };
}

async function daemonContainerExitCode(containerName: string): Promise<number> {
  const r = await limaTestVmRunner.run(
    `sudo nerdctl inspect -f '{{.State.ExitCode}}' ${containerName} 2>/dev/null || echo -1`,
    { timeoutMs: VM_WARM_TIMEOUT_MS }
  );
  return Number.parseInt(r.stdout.trim(), 10);
}

// ---------------------------------------------------------------------------
// The path-based device config the daemon's CLI child reads from /config. The
// device is addressed by PATH (`/ipod`) — the only addressing that resolves
// in-container (volumeUuid resolution fails: DEVICE_PATH_UNRESOLVED).
// ---------------------------------------------------------------------------
const PATH_CONFIG_TOML = [
  'version = 2',
  '[codec]',
  'lossy = ["aac"]',
  'lossless = ["aac"]',
  '[music.main]',
  'path = "/music"',
  '[devices.dockeripod]',
  'type = "ipod"',
  'path = "/ipod"',
  'volumeName = "IPOD_VIDEO"',
  '[defaults]',
  'device = "dockeripod"',
  'music = "main"',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// JSON envelope shape (only the field this test asserts on)
// ---------------------------------------------------------------------------
interface DeviceMusicJson {
  tracks?: number;
  fileTypes?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Detached-container teardown — best-effort stop + rm of `name`. Idempotent: a
// no-op when no container of that name exists. Called from afterAll AND every
// mid-setup failure path so a leaked `-d` container can never survive to break
// the next run.
// ---------------------------------------------------------------------------
async function removeDaemonContainer(name: string): Promise<void> {
  await limaTestVmRunner
    .run(
      `sudo nerdctl stop ${name} 2>/dev/null || true; ` +
        `sudo nerdctl rm ${name} 2>/dev/null || true`,
      { timeoutMs: VM_WARM_TIMEOUT_MS }
    )
    .catch(() => {});
}

/**
 * Poll a detached daemon container's logs until it reports a completed sync
 * cycle for `deviceLabel` (the daemon logs `Sync cycle completed successfully
 * for <label>` once tracks land), or the timeout elapses. Returns the last logs
 * seen. Early-exits on a logged sync failure so a lost run doesn't burn the full
 * timeout. The caller is responsible for turning a non-success into a thrown
 * assertion with the returned logs attached.
 */
async function waitForDaemonSync(
  containerName: string,
  deviceLabel: string
): Promise<{ synced: boolean; logs: string }> {
  const completeRe = new RegExp(
    `Sync cycle completed successfully for ${deviceLabel.replace(/[/\\]/g, '\\$&')}`
  );
  const failRe = new RegExp(
    `Sync failed for ${deviceLabel.replace(/[/\\]/g, '\\$&')}|completed with errors`
  );
  const deadline = Date.now() + SYNC_WAIT_TIMEOUT_MS;
  let logs = '';
  while (Date.now() < deadline) {
    const result = await limaTestVmRunner.run(`sudo nerdctl logs ${containerName} 2>&1`, {
      timeoutMs: VM_WARM_TIMEOUT_MS,
    });
    logs = result.stdout;
    if (completeRe.test(logs)) return { synced: true, logs };
    if (failRe.test(logs)) return { synced: false, logs };
    await new Promise((r) => setTimeout(r, SYNC_WAIT_POLL_MS));
  }
  return { synced: false, logs };
}

describe('VM: Docker dist image e2e (bundled daemon steady-state sync)', () => {
  // Default = the local in-VM build tag; reassigned in beforeAll to the pulled
  // registry tag when PODKIT_DOCKER_DIST_IMAGE is set.
  let IMAGE = DEFAULT_PODKIT_IMAGE_TAG;

  beforeAll(async () => {
    await limaTestVmRunner.prepare();
    // Resolve the docker-dist image once for the whole suite: build in-VM from
    // the current musl binaries (`force` guarantees a fresh image, not a stale
    // cached tag), or pull the pre-built artifact when the env switch is set.
    IMAGE = await ensurePodkitImageInVm({ force: true });
    await limaTestVmRunner.applyState(healthy);
  }, IMAGE_BUILD_TIMEOUT_MS);

  afterAll(async () => {
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  // --------------------------------------------------------------------------
  // Entrypoint regression: a leading flag (`--version`) is a CLI arg, not a raw
  // command to exec. A prior bug made `docker run <image> --version` die with
  // `exec: --: invalid option`; the entrypoint now routes leading flags through
  // podkit. This proves that fix end-to-end through the shipped image. Cheap —
  // no persona, no device, just the built image.
  // --------------------------------------------------------------------------
  it(
    'shipped image: `run <image> --version` routes to the CLI and exits 0',
    async () => {
      const result = await limaTestVmRunner.run(`sudo nerdctl run --rm ${sq(IMAGE)} --version`, {
        timeoutMs: CONTAINER_STEP_TIMEOUT_MS,
      });
      expect(result.exitCode).toBe(0);
      // The entrypoint banner ALSO prints a version line, so we assert a semver
      // appears anywhere in stdout rather than pinning it to the last line —
      // the point is that `--version` was accepted, not exec'd as an option.
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    },
    CONTAINER_STEP_TIMEOUT_MS
  );

  describe(`SystemState: ${healthy.id}`, () => {
    const PERSONA = ipodVideo5gIflash1tb;
    const VID = PERSONA.usbDescriptor.vendorId;
    const PID = PERSONA.usbDescriptor.productId;

    const VM_MOUNT_POINT = '/mnt/podkit-daemon-dockerdist';
    const VM_CONFIG_DIR = '/tmp/podkit-daemon-dockerdist-config';
    const VM_MUSIC_DIR = '/tmp/podkit-daemon-dockerdist-music';

    // Resolved in beforeAll AFTER the persona daemon is up (VZ-HID trap — filter
    // on the persona PID, never "first Apple device").
    let blockDevice = '';

    beforeAll(async () => {
      try {
        await mountPersona({
          personaId: PERSONA.id,
          vendorId: VID,
          productId: PID,
          mountPoint: VM_MOUNT_POINT,
        });

        // Resolve the block node filtered on the persona PID. We only need the
        // block device (for the read-back container); the daemon lane syncs the
        // bind-mounted `/ipod` path and needs no USB node.
        ({ blockDevice } = await resolvePersonaDeviceNodes({ vendorId: VID, productId: PID }));

        // Seed the empty FAT backing with a valid iPod filesystem + empty
        // iTunesDB (MA147 → iPod 5G Video) so the daemon's sync has a database
        // to write into. No SIE wipe here: the daemon lane never runs `device
        // add`, so there is no USB-inquiry write to prove — it syncs an
        // already-set-up device by path.
        const init = await limaTestVmRunner.run(`gpod-tool init ${VM_MOUNT_POINT} --model MA147`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });
        if (init.exitCode !== 0) {
          throw new Error(
            `gpod-tool init failed (exit=${init.exitCode}): ${init.stderr.trim() || init.stdout.trim()}`
          );
        }

        // Write the path-based device config bind-mounted to /config.
        await limaTestVmRunner.run(
          `mkdir -p ${VM_CONFIG_DIR} && printf '%s' ${sq(PATH_CONFIG_TOML)} > ${VM_CONFIG_DIR}/config.toml`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );

        // Two distinct FLACs the sync transcodes to AAC — distinct frequencies +
        // metadata so they land as two separate tracks.
        const makeFlac = (rel: string, frequency: number, title: string, track: number): string =>
          `ffmpeg -y -f lavfi -i 'sine=frequency=${frequency}:sample_rate=44100:duration=2' ` +
          `-metadata artist=${sq('Daemon Dist Artist')} -metadata album=${sq('Daemon Dist Album')} ` +
          `-metadata title=${sq(title)} -metadata track=${track} ` +
          `-c:a flac ${sq(`${VM_MUSIC_DIR}/${rel}`)} >/dev/null 2>&1`;

        const genScript = [
          'set -eu',
          `mkdir -p ${sq(VM_MUSIC_DIR)}`,
          makeFlac('track-01.flac', 440, 'Daemon Dist Track One', 1),
          makeFlac('track-02.flac', 660, 'Daemon Dist Track Two', 2),
        ].join('\n');
        const gen = await limaTestVmRunner.run(`bash -c ${sq(genScript)}`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });
        if (gen.exitCode !== 0) {
          throw new Error(
            `FLAC generation failed (exit=${gen.exitCode}): ${gen.stderr.trim() || gen.stdout.trim()}`
          );
        }
      } catch (err) {
        // Best-effort rollback so a failed setup doesn't leak a mount, temp
        // dirs, or (defensively) a same-named container.
        await removeDaemonContainer(MASS_STORAGE_DAEMON_CONTAINER);
        await limaTestVmRunner
          .run(`rm -rf ${VM_CONFIG_DIR} ${VM_MUSIC_DIR} 2>/dev/null || true`, {
            timeoutMs: VM_WARM_TIMEOUT_MS,
          })
          .catch(() => {});
        await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
        throw err;
      }
    }, VM_COLD_TIMEOUT_MS);

    afterAll(async () => {
      // Remove the detached daemon container FIRST — it holds a reference to the
      // /ipod bind-mount, so a lingering container would pin the unmount.
      await removeDaemonContainer(MASS_STORAGE_DAEMON_CONTAINER);
      await limaTestVmRunner
        .run(`rm -rf ${VM_CONFIG_DIR} ${VM_MUSIC_DIR} 2>/dev/null || true`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        })
        .catch(() => {});
      await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
    }, VM_COLD_TIMEOUT_MS);

    it(
      'bundled daemon (mass-storage lane): detects the mounted iPod and auto-syncs it (2 tracks land)',
      async () => {
        // Defensive: remove any same-named container a crashed prior run leaked
        // before starting the fresh one (otherwise `run --name` clashes).
        await removeDaemonContainer(MASS_STORAGE_DAEMON_CONTAINER);

        // Start the daemon DETACHED. `PODKIT_POLL_INTERVAL=2` keeps the detect →
        // sync latency short. `PODKIT_MASS_STORAGE_PATHS=/ipod` arms the
        // mass-storage lane against the bind-mounted persona FAT; the CLI child
        // reads the path-based config from /config and syncs `/ipod` as an iPod.
        const startCmd =
          `sudo nerdctl run -d --name ${MASS_STORAGE_DAEMON_CONTAINER} --device ${sq(blockDevice)} ` +
          `-e PUID=0 -e PGID=0 -e PODKIT_POLL_INTERVAL=2 -e PODKIT_MASS_STORAGE_PATHS=/ipod ` +
          `-v ${sq(`${VM_MOUNT_POINT}:/ipod`)} -v ${sq(`${VM_CONFIG_DIR}:/config`)} ` +
          `-v ${sq(`${VM_MUSIC_DIR}:/music:ro`)} ${sq(IMAGE)} daemon`;
        const start = await limaTestVmRunner.run(startCmd, {
          timeoutMs: CONTAINER_STEP_TIMEOUT_MS,
        });
        if (start.exitCode !== 0) {
          throw new Error(
            `daemon start failed (exit=${start.exitCode}): ${start.stderr.trim() || start.stdout.trim()}`
          );
        }

        // Wait for the daemon to report a completed sync of `/ipod` (the
        // mass-storage lane syncs by the bind-mount path). On timeout, the logs
        // are attached to the failure so a real failure is diagnosable.
        const { synced, logs } = await waitForDaemonSync(MASS_STORAGE_DAEMON_CONTAINER, '/ipod');
        if (!synced) {
          throw new Error(
            `daemon did not report a completed sync for /ipod within ${SYNC_WAIT_TIMEOUT_MS}ms\n` +
              `--- daemon logs ---\n${logs}`
          );
        }

        // Independent confirmation: read the device back through a one-shot
        // container and assert the two AAC tracks the daemon transcoded are
        // present. This proves the daemon's sync actually mutated the device,
        // not just that it logged success.
        const musicCmd =
          `sudo nerdctl run --rm --device ${sq(blockDevice)} -e PUID=0 -e PGID=0 ` +
          `-v ${sq(`${VM_MOUNT_POINT}:/ipod`)} -v ${sq(`${VM_CONFIG_DIR}:/config`)} ` +
          `${sq(IMAGE)} device music -d dockeripod --format json`;
        const music = await runContainerJson(musicCmd, CONTAINER_STEP_TIMEOUT_MS);
        assertContainerOk(music, 'device music');
        const musicJson = music.parsed as DeviceMusicJson;
        expect(musicJson.tracks).toBe(2);
        // Transcoded FLAC→AAC, so both tracks must be AAC. Asserted
        // unconditionally: a format-key regression must fail, not skip silently.
        expect(musicJson.fileTypes?.AAC).toBe(2);
      },
      DAEMON_FLOW_TIMEOUT_MS
    );
  });

  // --------------------------------------------------------------------------
  // iPod lsblk lane — the daemon's PRIMARY detection path for a plugged-in iPod.
  //
  // Unlike the mass-storage lane (which polls a bind-mounted directory), the
  // lsblk lane polls `lsblk` for a FAT volume whose base disk carries the Apple
  // USB vendor id in `/sys`, then `podkit mount`s the RAW block node inside the
  // container and syncs by the resulting mount path. This is the "plug a real
  // iPod into the container host" story, and it is the code path exercised by
  // the poller's whole-disk + partition detection.
  //
  // Two requirements distinguish this lane from the mass-storage one:
  //
  //   1. `--privileged`. The daemon runs `mount -t vfat <node> /tmp/podkit-…`
  //      inside the container. The default container profile filters the mount
  //      syscall even for root (`--device` + `SYS_ADMIN` are NOT enough), so the
  //      lane needs `--privileged`. This is a genuine operational requirement of
  //      in-container iPod mounting, asserted here so a regression that makes the
  //      lane silently require MORE (or a doc that claims it needs LESS) fails.
  //
  //   2. A PARTITIONED persona (`ipod5gVideoMbrPart`, MBR + FAT32 `sd?1`). The
  //      whole-disk sibling used by the mass-storage lane presents a bare `disk`
  //      node; a real MBR/FAT32 iPod presents a `part`. This persona restores the
  //      realistic partition shape so the poller's `type: "part"` branch — the
  //      common real-hardware case — is what gets exercised.
  // --------------------------------------------------------------------------
  describe(`SystemState: ${healthy.id} (lsblk lane)`, () => {
    const PERSONA = ipod5gVideoMbrPart;
    const VID = PERSONA.usbDescriptor.vendorId;
    const PID = PERSONA.usbDescriptor.productId;

    const VM_MOUNT_POINT = '/mnt/podkit-daemon-dockerdist-lsblk';
    const VM_CONFIG_DIR = '/tmp/podkit-daemon-dockerdist-lsblk-config';
    const VM_MUSIC_DIR = '/tmp/podkit-daemon-dockerdist-lsblk-music';

    // The raw block node (e.g. `/dev/sda`) and USB node, resolved after the
    // persona gadget is up. The daemon needs the block node (to enumerate +
    // mount the partition) and the USB node (so `/sys` carries the Apple vendor
    // id its iPod filter checks). Its data partition is `<blockDevice>1`.
    let blockDevice = '';
    let usbNode = '';

    beforeAll(async () => {
      try {
        // `mountPersona` seeds the persona daemon + mounts the FAT (its `sd?1`
        // fallback handles the partitioned backing) at VM_MOUNT_POINT — we use
        // that mount only to seed the iTunesDB, then unmount so the container's
        // daemon can mount the partition itself.
        await mountPersona({
          personaId: PERSONA.id,
          vendorId: VID,
          productId: PID,
          mountPoint: VM_MOUNT_POINT,
        });
        ({ blockDevice, usbNode } = await resolvePersonaDeviceNodes({
          vendorId: VID,
          productId: PID,
        }));

        // Seed the empty FAT data partition with a valid iPod filesystem + empty
        // iTunesDB so the daemon's sync has a database to write into.
        const init = await limaTestVmRunner.run(`gpod-tool init ${VM_MOUNT_POINT} --model MA147`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });
        if (init.exitCode !== 0) {
          throw new Error(
            `gpod-tool init failed (exit=${init.exitCode}): ${init.stderr.trim() || init.stdout.trim()}`
          );
        }

        // Unmount the host-side seed mount so the container's daemon owns the
        // mount. `unmountAndStop` would also stop the gadget, which we still
        // need up — so unmount the point directly (lazy fallback) and leave the
        // persona daemon running.
        await limaTestVmRunner
          .run(
            `sudo umount ${VM_MOUNT_POINT} 2>/dev/null || sudo umount -l ${VM_MOUNT_POINT} 2>/dev/null || true`,
            { timeoutMs: VM_WARM_TIMEOUT_MS }
          )
          .catch(() => {});

        // Config: no device block needed — the lsblk lane syncs the auto-mounted
        // partition BY PATH (`/tmp/podkit-<name>`), with global settings.
        const laneConfig = [
          'version = 2',
          '[codec]',
          'lossy = ["aac"]',
          'lossless = ["aac"]',
          '[music.main]',
          'path = "/music"',
          '[defaults]',
          'music = "main"',
          '',
        ].join('\n');
        await limaTestVmRunner.run(
          `mkdir -p ${VM_CONFIG_DIR} && printf '%s' ${sq(laneConfig)} > ${VM_CONFIG_DIR}/config.toml`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );

        const makeFlac = (rel: string, frequency: number, title: string, track: number): string =>
          `ffmpeg -y -f lavfi -i 'sine=frequency=${frequency}:sample_rate=44100:duration=2' ` +
          `-metadata artist=${sq('Daemon Lsblk Artist')} -metadata album=${sq('Daemon Lsblk Album')} ` +
          `-metadata title=${sq(title)} -metadata track=${track} ` +
          `-c:a flac ${sq(`${VM_MUSIC_DIR}/${rel}`)} >/dev/null 2>&1`;
        const genScript = [
          'set -eu',
          `mkdir -p ${sq(VM_MUSIC_DIR)}`,
          makeFlac('track-01.flac', 440, 'Daemon Lsblk Track One', 1),
          makeFlac('track-02.flac', 660, 'Daemon Lsblk Track Two', 2),
        ].join('\n');
        const gen = await limaTestVmRunner.run(`bash -c ${sq(genScript)}`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });
        if (gen.exitCode !== 0) {
          throw new Error(
            `FLAC generation failed (exit=${gen.exitCode}): ${gen.stderr.trim() || gen.stdout.trim()}`
          );
        }
      } catch (err) {
        await removeDaemonContainer(LSBLK_DAEMON_CONTAINER);
        await limaTestVmRunner
          .run(`rm -rf ${VM_CONFIG_DIR} ${VM_MUSIC_DIR} 2>/dev/null || true`, {
            timeoutMs: VM_WARM_TIMEOUT_MS,
          })
          .catch(() => {});
        await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
        throw err;
      }
    }, VM_COLD_TIMEOUT_MS);

    afterAll(async () => {
      await removeDaemonContainer(LSBLK_DAEMON_CONTAINER);
      await limaTestVmRunner
        .run(`rm -rf ${VM_CONFIG_DIR} ${VM_MUSIC_DIR} 2>/dev/null || true`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        })
        .catch(() => {});
      await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
    }, VM_COLD_TIMEOUT_MS);

    it(
      'bundled daemon (lsblk lane): auto-detects the partitioned iPod, mounts it, and syncs (2 tracks land)',
      async () => {
        await removeDaemonContainer(LSBLK_DAEMON_CONTAINER);

        // The daemon's data-partition node is `<blockDevice>1` (e.g. `/dev/sda1`).
        // We pass BOTH the whole-disk node (so lsblk enumerates the partition and
        // `/sys/block/<disk>` resolves the vendor id) and the USB node (so the
        // Apple-vendor `/sys` walk succeeds). `--privileged` is REQUIRED: the
        // daemon mounts the partition in-container, which the default profile
        // blocks even for root.
        const partitionNode = `${blockDevice}1`;
        const startCmd =
          `sudo nerdctl run -d --name ${LSBLK_DAEMON_CONTAINER} --privileged ` +
          `--device ${sq(blockDevice)} --device ${sq(partitionNode)} --device ${sq(usbNode)} ` +
          `-e PUID=0 -e PGID=0 -e PODKIT_POLL_INTERVAL=2 ` +
          `-v ${sq(`${VM_CONFIG_DIR}:/config`)} -v ${sq(`${VM_MUSIC_DIR}:/music:ro`)} ` +
          `${sq(IMAGE)} daemon`;
        const start = await limaTestVmRunner.run(startCmd, {
          timeoutMs: CONTAINER_STEP_TIMEOUT_MS,
        });
        if (start.exitCode !== 0) {
          throw new Error(
            `daemon start failed (exit=${start.exitCode}): ${start.stderr.trim() || start.stdout.trim()}`
          );
        }

        // The lane logs the completed cycle under the partition's kernel name
        // (e.g. `sda1`), not a path — derive it from the resolved node.
        const partitionName = partitionNode.replace(/^\/dev\//, '');
        const { synced, logs } = await waitForDaemonSync(LSBLK_DAEMON_CONTAINER, partitionName);
        if (!synced) {
          throw new Error(
            `daemon did not report a completed lsblk-lane sync for ${partitionName} within ` +
              `${SYNC_WAIT_TIMEOUT_MS}ms\n--- daemon logs ---\n${logs}`
          );
        }

        // Confirm the two AAC tracks landed. Read the partition back through a
        // one-shot container: mount the partition on the host, bind it to /ipod,
        // and read via a path-based device entry. `--privileged` not needed for
        // the read (the host owns the mount; the container only reads /ipod).
        const readConfig = [
          'version = 2',
          '[codec]',
          'lossy = ["aac"]',
          'lossless = ["aac"]',
          '[music.main]',
          'path = "/music"',
          '[devices.laneipod]',
          'type = "ipod"',
          'path = "/ipod"',
          'volumeName = "IPOD_VIDEO"',
          '[defaults]',
          'device = "laneipod"',
          'music = "main"',
          '',
        ].join('\n');
        await limaTestVmRunner.run(
          `printf '%s' ${sq(readConfig)} > ${VM_CONFIG_DIR}/config.toml && ` +
            `sudo mount -t vfat -o uid=$(id -u),gid=$(id -g) ${sq(partitionNode)} ${VM_MOUNT_POINT}`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );
        try {
          const musicCmd =
            `sudo nerdctl run --rm --device ${sq(blockDevice)} --device ${sq(partitionNode)} ` +
            `-e PUID=0 -e PGID=0 -v ${sq(`${VM_MOUNT_POINT}:/ipod`)} ` +
            `-v ${sq(`${VM_CONFIG_DIR}:/config`)} ${sq(IMAGE)} device music -d laneipod --format json`;
          const music = await runContainerJson(musicCmd, CONTAINER_STEP_TIMEOUT_MS);
          assertContainerOk(music, 'device music (lsblk lane read-back)');
          const musicJson = music.parsed as DeviceMusicJson;
          expect(musicJson.tracks).toBe(2);
          expect(musicJson.fileTypes?.AAC).toBe(2);
        } finally {
          // Release the read-back mount so afterAll's unmount is clean.
          await limaTestVmRunner
            .run(
              `sudo umount ${VM_MOUNT_POINT} 2>/dev/null || sudo umount -l ${VM_MOUNT_POINT} 2>/dev/null || true`,
              { timeoutMs: VM_WARM_TIMEOUT_MS }
            )
            .catch(() => {});
        }
      },
      DAEMON_FLOW_TIMEOUT_MS
    );
  });

  // --------------------------------------------------------------------------
  // SIGTERM graceful-drain + Apprise notification.
  //
  // Both are ORCHESTRATOR behaviors, but they run on the iPod lsblk lane (the
  // same one AC1 uses) so the daemon owns the mount — a SIGTERM then exercises
  // the real mount → sync → SIGINT-drain → eject unwind. `--privileged` +
  // `--device` (block + USB) + a device-LESS config (path-based fallback) match
  // the lane. A 60-track FLAC set makes the sync run several seconds so a SIGTERM
  // lands MID-sync; the engine checkpoints the iTunesDB every 10 completed
  // tracks, so a drained interrupt preserves the completed subset.
  //
  // `--network host` lets the daemon reach the mock Apprise endpoint on the VM
  // host (127.0.0.1). Each `it` re-inits the device DB first, so it is
  // retry-safe and order-independent — a re-run always faces a fresh empty DB.
  // --------------------------------------------------------------------------
  describe(`SystemState: ${healthy.id} (SIGTERM drain + Apprise)`, () => {
    const PERSONA = ipodVideo5gIflash1tb;
    const VID = PERSONA.usbDescriptor.vendorId;
    const PID = PERSONA.usbDescriptor.productId;

    const VM_MOUNT_POINT = '/mnt/podkit-daemon-dockerdist-drain';
    const VM_CONFIG_DIR = '/tmp/podkit-daemon-dockerdist-drain-config';
    const VM_MUSIC_DIR = '/tmp/podkit-daemon-dockerdist-drain-music';
    // 120 tracks (not the minimum needed) so the sync stays in-flight across a
    // wide range of machine speeds: the interrupt below must land AFTER ≥1
    // checkpoint (10 tracks) but BEFORE the sync finishes. A larger set widens
    // the upper-margin (a fast host can't finish 120 in the dwell window); the
    // dwell widens the lower-margin (a slow host still completes ≥10).
    const TRACK_COUNT = 120;

    // Device-less config: the iPod lane auto-mounts the detected device and syncs
    // it by mount path (unregistered → path-based fallback, global settings).
    const DRAIN_MUSIC_CONFIG = [
      'version = 2',
      '[codec]',
      'lossy = ["aac"]',
      'lossless = ["aac"]',
      '[music.main]',
      'path = "/music"',
      '[defaults]',
      'music = "main"',
      '',
    ].join('\n');

    let blockDevice = '';
    let usbNode = '';

    /**
     * Mount the persona backing at VM_MOUNT_POINT (whole-disk, `sd?1` fallback).
     * A writable mount uses `uid/gid` so the non-root `gpod-tool` can create the
     * iPod filesystem (matches how `mountPersona` and the read-back mount do it);
     * a read-only mount is enough for counting.
     */
    const mountBacking = async (readOnly = false): Promise<void> => {
      const opt = readOnly ? '-o ro' : '-o uid=$(id -u),gid=$(id -g)';
      await limaTestVmRunner.run(
        `sudo mkdir -p ${VM_MOUNT_POINT}; ` +
          `sudo mount ${opt} ${sq(blockDevice)} ${VM_MOUNT_POINT} 2>/dev/null || ` +
          `sudo mount ${opt} ${sq(blockDevice)}1 ${VM_MOUNT_POINT} 2>/dev/null || true`,
        { timeoutMs: VM_WARM_TIMEOUT_MS }
      );
    };
    const umountBacking = async (): Promise<void> => {
      await limaTestVmRunner
        .run(
          `sudo umount ${VM_MOUNT_POINT} 2>/dev/null || sudo umount -l ${VM_MOUNT_POINT} 2>/dev/null || true`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        )
        .catch(() => {});
    };

    /**
     * Reset the device to a clean, empty iPod filesystem so each attempt starts
     * fresh. Mounts the backing (the daemon runs with it UNMOUNTED), wipes any
     * prior iPod_Control, re-inits, then unmounts so the container owns the mount.
     */
    const reinitDevice = async (): Promise<void> => {
      await mountBacking(false);
      const init = await limaTestVmRunner.run(
        `sudo rm -rf ${VM_MOUNT_POINT}/iPod_Control && gpod-tool init ${VM_MOUNT_POINT} --model MA147`,
        { timeoutMs: VM_WARM_TIMEOUT_MS }
      );
      await umountBacking();
      if (init.exitCode !== 0) {
        throw new Error(
          `gpod-tool init failed (exit=${init.exitCode}): ${init.stderr || init.stdout}`
        );
      }
    };

    /**
     * Start the daemon detached on the iPod lsblk lane. `--privileged` is
     * required (the daemon mounts the block node in-container); `--device`
     * block + USB nodes make lsblk enumerate the device and `/sys` carry the
     * Apple vendor id; `--network host` lets it reach the mock Apprise endpoint.
     */
    const startDrainDaemon = async (): Promise<void> => {
      await removeDaemonContainer(DRAIN_DAEMON_CONTAINER);
      const startCmd =
        `sudo nerdctl run -d --name ${DRAIN_DAEMON_CONTAINER} --privileged --network host ` +
        `--device ${sq(blockDevice)} --device ${sq(usbNode)} ` +
        `-e PUID=0 -e PGID=0 -e PODKIT_POLL_INTERVAL=2 ` +
        `-e PODKIT_APPRISE_URL=http://127.0.0.1:${APPRISE_PORT}/notify ` +
        `-v ${sq(`${VM_CONFIG_DIR}:/config`)} -v ${sq(`${VM_MUSIC_DIR}:/music:ro`)} ` +
        `${sq(IMAGE)} daemon`;
      const start = await limaTestVmRunner.run(startCmd, { timeoutMs: CONTAINER_STEP_TIMEOUT_MS });
      if (start.exitCode !== 0) {
        throw new Error(
          `daemon start failed (exit=${start.exitCode}): ${start.stderr || start.stdout}`
        );
      }
    };

    /** Mount the backing read-only and count files under iPod_Control/Music. */
    const countMusicFiles = async (): Promise<number> => {
      await mountBacking(true);
      const r = await limaTestVmRunner.run(
        `find ${VM_MOUNT_POINT}/iPod_Control/Music -type f 2>/dev/null | wc -l`,
        { timeoutMs: VM_WARM_TIMEOUT_MS }
      );
      await umountBacking();
      return Number.parseInt(r.stdout.trim(), 10) || 0;
    };

    beforeAll(async () => {
      try {
        await mountPersona({
          personaId: PERSONA.id,
          vendorId: VID,
          productId: PID,
          mountPoint: VM_MOUNT_POINT,
        });
        ({ blockDevice, usbNode } = await resolvePersonaDeviceNodes({
          vendorId: VID,
          productId: PID,
        }));
        await limaTestVmRunner.run(
          `mkdir -p ${VM_CONFIG_DIR} && printf '%s' ${sq(DRAIN_MUSIC_CONFIG)} > ${VM_CONFIG_DIR}/config.toml`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );
        // 60 short FLACs so the sync runs long enough to interrupt mid-flight.
        const genScript = [
          'set -eu',
          `mkdir -p ${sq(VM_MUSIC_DIR)}`,
          `for i in $(seq 1 ${TRACK_COUNT}); do`,
          '  f=$((300 + i * 20));',
          `  ffmpeg -y -f lavfi -i "sine=frequency=$f:sample_rate=44100:duration=4" ` +
            `-metadata artist=DaemonDrain -metadata album=DaemonDrain -metadata title="Track $i" -metadata track=$i ` +
            `-c:a flac ${sq(VM_MUSIC_DIR)}/track-$i.flac >/dev/null 2>&1;`,
          'done',
        ].join('\n');
        const gen = await limaTestVmRunner.run(`bash -c ${sq(genScript)}`, { timeoutMs: 180_000 });
        if (gen.exitCode !== 0) {
          throw new Error(`FLAC gen failed (exit=${gen.exitCode}): ${gen.stderr || gen.stdout}`);
        }
        // mountPersona left the backing mounted; the iPod lane needs it UNMOUNTED
        // so the daemon container owns the mount. Each `it` re-inits it fresh.
        await umountBacking();
        await startMockApprise();
      } catch (err) {
        await removeDaemonContainer(DRAIN_DAEMON_CONTAINER);
        await stopMockApprise();
        await limaTestVmRunner
          .run(`rm -rf ${VM_CONFIG_DIR} ${VM_MUSIC_DIR} 2>/dev/null || true`, {
            timeoutMs: VM_WARM_TIMEOUT_MS,
          })
          .catch(() => {});
        await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
        throw err;
      }
    }, VM_COLD_TIMEOUT_MS);

    afterAll(async () => {
      await removeDaemonContainer(DRAIN_DAEMON_CONTAINER);
      await stopMockApprise();
      await limaTestVmRunner
        .run(`rm -rf ${VM_CONFIG_DIR} ${VM_MUSIC_DIR} 2>/dev/null || true`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        })
        .catch(() => {});
      await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
    }, VM_COLD_TIMEOUT_MS);

    it(
      'delivers a sync-complete Apprise notification after a full sync',
      async () => {
        await removeDaemonContainer(DRAIN_DAEMON_CONTAINER);
        await reinitDevice();
        await limaTestVmRunner.run(`rm -f ${APPRISE_CAPTURE}`, { timeoutMs: VM_WARM_TIMEOUT_MS });
        await startDrainDaemon();

        const { matched, logs } = await waitForDaemonLog(
          DRAIN_DAEMON_CONTAINER,
          /Sync cycle completed successfully for sda/
        );
        expect(matched, `daemon never completed a sync. Logs:\n${logs}`).toBe(true);

        const capture = await readAppriseCapture();
        expect(capture, `no Apprise notification captured. Logs:\n${logs}`).toMatch(
          /sync complete/i
        );
        expect(capture).toContain(`${TRACK_COUNT} tracks added`);

        await removeDaemonContainer(DRAIN_DAEMON_CONTAINER);
      },
      DAEMON_FLOW_TIMEOUT_MS
    );

    it(
      'SIGTERM mid-sync → graceful drain: container exits 0 and completed tracks are preserved',
      async () => {
        await removeDaemonContainer(DRAIN_DAEMON_CONTAINER);
        await reinitDevice();
        await startDrainDaemon();

        // Wait for the REAL sync to start, then dwell so a couple of checkpoint
        // saves land (engine checkpoints every 10 completed tracks), then SIGTERM.
        const { matched, logs: planLogs } = await waitForDaemonLog(
          DRAIN_DAEMON_CONTAINER,
          /Sync plan/
        );
        expect(matched, `daemon never reached the sync plan. Logs:\n${planLogs}`).toBe(true);
        await limaTestVmRunner.run('sleep 4', { timeoutMs: VM_WARM_TIMEOUT_MS });

        // `nerdctl stop` → SIGTERM (15s grace before SIGKILL). PID 1 is the
        // daemon (entrypoint `exec podkit-daemon`), so it receives the signal.
        await limaTestVmRunner.run(`sudo nerdctl stop --time 15 ${DRAIN_DAEMON_CONTAINER}`, {
          timeoutMs: 30_000,
        });

        const exit = await daemonContainerExitCode(DRAIN_DAEMON_CONTAINER);
        const logs = (
          await limaTestVmRunner.run(`sudo nerdctl logs ${DRAIN_DAEMON_CONTAINER} 2>&1 || true`, {
            timeoutMs: VM_WARM_TIMEOUT_MS,
          })
        ).stdout;
        // Graceful shutdown → exit 0, not a SIGKILL (137).
        expect(exit, `expected graceful exit 0, got ${exit}. Logs:\n${logs}`).toBe(0);
        expect(logs).toContain('Aborting in-progress iPod sync');
        expect(logs).toContain('Sync aborted gracefully');
        expect(logs).toContain('Shutdown complete');

        // Completed tracks preserved: the drained iTunesDB carries the
        // checkpointed subset — a non-empty partial (the device is bind-mounted,
        // so the host mount reflects the container's writes directly).
        const tracks = await countMusicFiles();
        expect(tracks).toBeGreaterThanOrEqual(10);
        expect(tracks).toBeLessThan(TRACK_COUNT);

        await removeDaemonContainer(DRAIN_DAEMON_CONTAINER);
      },
      DAEMON_FLOW_TIMEOUT_MS
    );
  });
});
