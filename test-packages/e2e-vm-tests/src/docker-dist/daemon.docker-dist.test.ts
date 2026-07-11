/**
 * Tier-5 Docker image e2e — the BUNDLED daemon driving a steady-state sync of a
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
 * @see test-packages/e2e-vm-tests/src/docker-dist/image.docker-dist.test.ts (the one-shot CLI sibling)
 * @see packages/podkit-daemon/src/device-poller.ts (the two detection lanes)
 * @see agents/docker.md ("Running Tier 5 locally")
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  DEFAULT_PODKIT_IMAGE_TAG,
  buildPodkitImageInVm,
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
  const IMAGE = DEFAULT_PODKIT_IMAGE_TAG;

  beforeAll(async () => {
    await limaTestVmRunner.prepare();
    // Build the production-shaped musl image once for the whole suite. `force`
    // guarantees a fresh image from the current binaries, not a stale cached tag.
    await buildPodkitImageInVm({ force: true });
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
});
