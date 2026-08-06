/**
 * E2E · vm-docker-image · usb-synth — the shipped musl image driving a
 * synthesized USB iPod inside the device-harness Lima VM, with real device
 * passthrough. (doc-053 rollout stage 5; taxonomy: documents/architecture/testing/taxonomy.md)
 *
 * This is the ONLY surface that exercises the container's real device-access path
 * end to end: the production `alpine:3.21` (musl) image, built from the same
 * binaries CI ships, runs `device add` → live USB firmware inquiry → SIE write,
 * then a real FLAC→AAC sync, then reads the tracks back — all through
 * `nerdctl run --device …` passthrough of a gadget the harness synthesizes.
 *
 * # Why this lives in `src/vm-docker/` (gated out of the routine VM run)
 *
 * The `vm-docker` Surface directory marks these as exercising the shipped
 * Docker *distribution* image inside the VM — distinct from the
 * `src/docker-source/` files in `@podkit/e2e-tests`, which merely use Docker as
 * infra to host a Subsonic/Navidrome source. Everything under `src/vm-docker/`
 * is deliberately excluded from the routine `test:vm` run and from the
 * `quality` DAG: it builds a full Docker image in the VM (minutes) and drives a
 * live synthesized USB device, so it is expensive and fragile. It runs
 * locally-only via `bun run test:e2e:docker-dist` (see this package's
 * `package.json` and `agents/docker.md`). The dedicated directory also means a
 * stray `bun test` elsewhere in the repo will not accidentally kick off an
 * image build — bunfig.toml's `pathIgnorePatterns` excludes the `vm-docker/`
 * directory; only the explicit `test:e2e:docker-dist` script re-includes it.
 *
 * # Persona choice + its documented caveat
 *
 * The persona is the 5G Video (`ipodVideo5gIflash1tb`, VID 05ac / PID 1209). Its
 * daemon binds BOTH FunctionFS (serving the live USB SIE vendor read over
 * bmRequestType 0xC0) AND mass-storage (giving a `/dev/sd<x>` block node + a
 * 256 MiB FAT32 backing), and it is a syncable generation. That makes it the
 * ready-made vehicle to prove the USB-inquiry CODE PATH plus the full sync
 * pipeline through the image.
 *
 * CAVEAT: a real 5G Video uses SCSI inquiry, not USB — so this persona proves
 * the USB-inquiry code path + sync pipeline, NOT 5G-over-USB realism. A
 * USB-native syncable FAT persona is the realism refinement, deferred to the
 * fuller vm-docker-image persona-matrix work (DRAFT-021).
 *
 * # Setup + the gotchas this test must handle (each learned the hard way)
 *
 *   Empty backing → seed a database. The synthesized FAT backing is empty (no
 *   iPod_Control, no iTunesDB), so `sync` would fail IPOD_NEEDS_INIT. We seed a
 *   valid filesystem + empty iTunesDB with `gpod-tool init --model MA147` (5G
 *   Video) before the container steps.
 *
 *   1. VZ-HID trap. Never target "first Apple device": the VZ guest exposes
 *      Apple-vendor HID nodes that share VID 05ac. We resolve the block + USB
 *      nodes via `resolvePersonaDeviceNodes({ vendorId, productId })`, which
 *      filters on the persona PID. It must be called AFTER `mountPersona` (the
 *      daemon must be up and `/dev/sg*` enumerated first).
 *
 *   2. PUID=0 + `--device <blockDevice>`. Reading the block-device UUID
 *      (libblkid) fails as uid=1000 on the `root disk` node, so `device add`
 *      runs with `-e PUID=0 -e PGID=0` AND the block node passed via `--device`.
 *
 *   3. Two-phase config (UUID → path). `device add` writes the device entry keyed
 *      by `volumeUuid`, but volumeUuid resolution fails inside the container
 *      (DEVICE_PATH_UNRESOLVED). So the ADD phase runs against a device-less
 *      config (add creates the entry, proving the SIE write); then we overwrite
 *      with a PATH-based entry (`path = "/ipod"` + `-d dockeripod`) for the sync
 *      + read-back — the only addressing that resolves in-container.
 *
 *   4. Fresh SIE from USB. We wipe any on-disk SysInfoExtended BEFORE `device
 *      add` so the live USB inquiry writes it fresh — that write is exactly what
 *      the first assertion proves. (`gpod-tool init` writes a classic SysInfo but
 *      no SysInfoExtended; the two agree on the 5G Video, so add verifies.)
 *
 * @see test-packages/device-testing/src/runners/lima-docker-image.ts (buildPodkitImageInVm)
 * @see test-packages/device-testing/src/vm/mount-persona.ts (resolvePersonaDeviceNodes)
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
} from '@podkit/device-testing';

import { sq, runContainerJson, assertContainerOk } from './container-helpers.js';

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/**
 * The in-VM image build can take several minutes; give the `beforeAll` a wide
 * budget well beyond the standard cold-VM one.
 */
const IMAGE_BUILD_TIMEOUT_MS = 600_000;

/**
 * Each `nerdctl run` starts a container, and the sync step additionally runs
 * two ffmpeg transcodes inside it. Give the container steps a generous budget.
 */
const CONTAINER_STEP_TIMEOUT_MS = 180_000;

/**
 * The whole add → sync → read-back flow is one `it` (three container runs plus
 * per-attempt seeding), so it needs a budget covering all three steps.
 */
const FLOW_TIMEOUT_MS = CONTAINER_STEP_TIMEOUT_MS * 3;

// ---------------------------------------------------------------------------
// JSON envelope shapes (only the fields this test asserts on)
// ---------------------------------------------------------------------------

interface AddSuccessJson {
  success: boolean;
  verification?: 'verified' | 'trusted-disk' | 'config-only';
}

interface SyncOutputJson {
  success?: boolean;
  status?: string;
  // `podkit sync --json` nests the tallies under `result`, not at top level.
  result?: { completed?: number; failed?: number };
}

interface DeviceMusicJson {
  tracks?: number;
  fileTypes?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// The two config.toml phases driven into the VM and bind-mounted as /config.
// The image reads config from `/config/config.toml` (PODKIT_CONFIG in the
// Dockerfile).
//
// The device is addressed in TWO phases because of a container constraint:
//
//   ADD phase — the device is deliberately NOT pre-declared. `device add -d
//   dockeripod --path /ipod` is what WRITES the `[devices.dockeripod]` entry (from
//   the live USB inquiry); pre-declaring it makes add fail with DEVICE_EXISTS.
//   But add persists that entry keyed by `volumeUuid`, and volumeUuid resolution
//   FAILS inside the container (DEVICE_PATH_UNRESOLVED) — so the add-written
//   config is unusable for a subsequent sync.
//
//   PATH phase — before syncing we overwrite the config with a PATH-based device
//   entry (gotcha #3): `[devices.dockeripod]` with `path = "/ipod"`, addressed via
//   `-d dockeripod`. This is the only addressing that resolves in-container.
// ---------------------------------------------------------------------------

/** ADD phase: no device block, so `device add` creates one (proving the SIE write). */
const ADD_CONFIG_TOML = [
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

/** PATH phase: path-based device entry for the in-container sync + read-back. */
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

// The image the container steps run against. Default = the local in-VM build
// tag; when PODKIT_DOCKER_DIST_IMAGE is set, `ensurePodkitImageInVm` pulls that
// registry tag instead and this is reassigned to it in beforeAll.
let IMAGE = DEFAULT_PODKIT_IMAGE_TAG;

describe('VM: Docker dist image e2e (musl image + synthesized USB iPod)', () => {
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

  describe(`SystemState: ${healthy.id}`, () => {
    const PERSONA = ipodVideo5gIflash1tb;
    const VID = PERSONA.usbDescriptor.vendorId;
    const PID = PERSONA.usbDescriptor.productId;

    const VM_MOUNT_POINT = '/mnt/podkit-docker-dist';
    const VM_CONFIG_DIR = '/tmp/podkit-docker-dist-config';
    const VM_MUSIC_DIR = '/tmp/podkit-docker-dist-music';

    // Resolved in beforeAll AFTER the daemon is up (VZ-HID trap, gotcha #1).
    let blockDevice = '';
    let usbNode = '';

    beforeAll(async () => {
      try {
        await mountPersona({
          personaId: PERSONA.id,
          vendorId: VID,
          productId: PID,
          mountPoint: VM_MOUNT_POINT,
        });

        // Resolve the block + USB nodes filtered on the persona PID — never
        // "first Apple device" (gotcha #1). Must run after mountPersona so the
        // daemon is up and /dev/sg* enumerated.
        ({ blockDevice, usbNode } = await resolvePersonaDeviceNodes({
          vendorId: VID,
          productId: PID,
        }));

        // Create the dir we bind-mount to /config. The per-attempt device
        // seeding (gpod-tool init, SIE wipe, ADD-phase config) lives in the test
        // body, NOT here, so a retry re-establishes a clean pre-add state — the
        // SIE-write proof needs SysInfoExtended absent at the start of each try.
        await limaTestVmRunner.run(`mkdir -p ${VM_CONFIG_DIR}`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });

        // Generate two distinct FLACs the sync will transcode to AAC. Sine
        // tones with distinct frequencies + metadata so they land as two
        // separate tracks (matching the save-failure-matrix generation idiom).
        const makeFlac = (rel: string, frequency: number, title: string, track: number): string =>
          `ffmpeg -y -f lavfi -i 'sine=frequency=${frequency}:sample_rate=44100:duration=2' ` +
          `-metadata artist=${sq('Docker Dist Artist')} -metadata album=${sq('Docker Dist Album')} ` +
          `-metadata title=${sq(title)} -metadata track=${track} ` +
          `-c:a flac ${sq(`${VM_MUSIC_DIR}/${rel}`)} >/dev/null 2>&1`;

        const genScript = [
          'set -eu',
          `mkdir -p ${sq(VM_MUSIC_DIR)}`,
          makeFlac('track-01.flac', 440, 'Docker Dist Track One', 1),
          makeFlac('track-02.flac', 660, 'Docker Dist Track Two', 2),
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
      await limaTestVmRunner
        .run(`rm -rf ${VM_CONFIG_DIR} ${VM_MUSIC_DIR} 2>/dev/null || true`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        })
        .catch(() => {});
      await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
    }, VM_COLD_TIMEOUT_MS);

    // One ordered flow, not three `it`s: add → sync → read-back each depend on
    // the previous step's on-device side effects. Kept as a single `it` so a
    // retry (bunfig `retry`) re-runs the per-attempt seeding below from scratch
    // rather than resuming from a half-mutated device — the SIE-write proof
    // needs a clean pre-add state, and a retried `device add` against an
    // already-added config would fail DEVICE_EXISTS.
    it(
      'shipped image: device add → sync → read-back over USB passthrough',
      async () => {
        // ---- Per-attempt seed (re-runs on retry) ----------------------------
        // Empty FAT backing → seed a valid iPod filesystem + empty iTunesDB
        // (MA147 → iPod 5G Video) so `sync` has a database to write into. Writes
        // a classic SysInfo, but NOT a SysInfoExtended.
        const init = await limaTestVmRunner.run(`gpod-tool init ${VM_MOUNT_POINT} --model MA147`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });
        if (init.exitCode !== 0) {
          throw new Error(
            `gpod-tool init failed (exit=${init.exitCode}): ${init.stderr.trim() || init.stdout.trim()}`
          );
        }
        // Wipe any on-disk SysInfoExtended (gotcha #4) so `device add` writes it
        // fresh from the live USB inquiry — the write the first assertion proves.
        // The classic SysInfo gpod-tool wrote and the USB inquiry both resolve to
        // the 5G Video, so add verifies (no IDENTITY_MISMATCH).
        await limaTestVmRunner.run(`rm -f ${VM_MOUNT_POINT}/iPod_Control/Device/SysInfoExtended`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });
        // ADD phase: device-less config, so `device add` creates the entry
        // (proving the SIE write). Pre-declaring it would fail DEVICE_EXISTS.
        await limaTestVmRunner.run(
          `printf '%s' ${sq(ADD_CONFIG_TOML)} > ${VM_CONFIG_DIR}/config.toml`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );

        // ---- 1) device add: USB inquiry → SIE write + device entry ----------
        const addCmd =
          `sudo nerdctl run --rm --device ${sq(usbNode)} --device ${sq(blockDevice)} ` +
          `-e PUID=0 -e PGID=0 -v ${sq(`${VM_MOUNT_POINT}:/ipod`)} ` +
          `-v ${sq(`${VM_CONFIG_DIR}:/config`)} ` +
          `${sq(IMAGE)} device add -d dockeripod --path /ipod --yes --json`;
        const add = await runContainerJson(addCmd, CONTAINER_STEP_TIMEOUT_MS);
        assertContainerOk(add, 'device add');
        const addJson = add.parsed as AddSuccessJson;
        expect(addJson.success).toBe(true);
        expect(addJson.verification).toBe('verified');

        // Prove the USB-inquiry SIE write: absent pre-add (wiped above), now a
        // non-trivial plist (>1 KiB).
        const siePath = `${VM_MOUNT_POINT}/iPod_Control/Device/SysInfoExtended`;
        const stat = await limaTestVmRunner.run(
          `[ -f ${sq(siePath)} ] && wc -c < ${sq(siePath)} || echo MISSING`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );
        expect(stat.stdout.trim()).not.toBe('MISSING');
        const bytes = Number.parseInt(stat.stdout.trim(), 10);
        expect(Number.isNaN(bytes)).toBe(false);
        expect(bytes).toBeGreaterThan(1024);

        // ---- 2) sync: transcode FLAC→AAC onto the device --------------------
        // `device add` persisted a volumeUuid-keyed entry, unusable in-container
        // (DEVICE_PATH_UNRESOLVED). Overwrite with the PATH-based config so sync
        // resolves `-d dockeripod` by path.
        await limaTestVmRunner.run(
          `printf '%s' ${sq(PATH_CONFIG_TOML)} > ${VM_CONFIG_DIR}/config.toml`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );
        const syncCmd =
          `sudo nerdctl run --rm --device ${sq(usbNode)} --device ${sq(blockDevice)} ` +
          `-e PUID=0 -e PGID=0 -v ${sq(`${VM_MOUNT_POINT}:/ipod`)} ` +
          `-v ${sq(`${VM_CONFIG_DIR}:/config`)} ` +
          `-v ${sq(`${VM_MUSIC_DIR}:/music:ro`)} ` +
          `${sq(IMAGE)} sync -d dockeripod -t music --json`;
        const sync = await runContainerJson(syncCmd, CONTAINER_STEP_TIMEOUT_MS);
        assertContainerOk(sync, 'sync');
        const syncJson = sync.parsed as SyncOutputJson;
        expect(syncJson.success).toBe(true);
        expect(syncJson.status).toBe('ok');
        expect(syncJson.result?.completed).toBe(2);
        expect(syncJson.result?.failed).toBe(0);

        // ---- 3) device music: read the two synced tracks back ---------------
        // usbNode omitted — read-back needs only the block device.
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
      FLOW_TIMEOUT_MS
    );
  });
});
