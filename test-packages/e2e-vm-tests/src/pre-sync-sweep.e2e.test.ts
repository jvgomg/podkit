/**
 * VM coverage — pre-sync debris sweep SIGKILL round-trip.
 *
 * Unit coverage for the sweep itself (per-scanner walkers, pre-flight
 * cleanup, dry-run no-op, failure-becomes-warning) lives in
 * `packages/podkit-core/src/sync/engine/pre-sync-sweep.test.ts`. This file
 * pins the end-to-end story: kill a real `podkit sync` mid-flight, observe
 * the debris on disk, run the next sync, assert the cleanup line + that
 * the final state is clean.
 *
 * # Mechanics
 *
 * The debug build of podkit (`bin/podkit-debug`, see
 * `documents/architecture/dev-builds.md`) carries an active
 * {@link devPause}/{@link devPauseSync} hook surface. Two pause keys are
 * wired:
 *
 *   - `pre-rename-track` — fires inside `atomicCopyFile`, between the
 *     `.podkit-tmp` write and the rename. A SIGKILL here leaves a sibling
 *     `.podkit-tmp` next to the final destination — exactly the debris
 *     the mass-storage scanner surfaces.
 *
 *   - `pre-rename-transcode` — fires inside the music pipeline's
 *     `prepareTranscode` / `prepareOptimizedCopy`, between FFmpeg's
 *     write to the temp output and the move-out rename. A SIGKILL here
 *     leaves the orphan `podkit-transcode-<uuid>/` scratch dir on the
 *     host tmpdir.
 *
 * Production binary invocations stay on `bin/podkit` and exercise the
 * actual shipping artefact — only the pause-bearing run uses the debug
 * binary.
 *
 * # Synchronisation
 *
 * The pause hook blocks the process; the test polls disk for the expected
 * tmp artefact (the rename's input file or the transcode dir) every 50ms
 * up to a 30s deadline. Once observed, the test SIGKILLs the process
 * group and proceeds. There is no resume signalling — by design (TASK-405).
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  healthy,
  echoMini,
  startDaemonForPersona,
  stopDaemon,
  waitForScsiGenericEnumeration,
  resolveDefaultPodkitDebugBinary,
  LIMA_DEVICE_HARNESS_VM_NAME,
} from '@podkit/device-testing';

// ---------------------------------------------------------------------------
// Constants + paths inside the VM
// ---------------------------------------------------------------------------

const VM_MOUNT_POINT = '/mnt/podkit-pre-sync-sweep';
const VM_SOURCE_DIR = '/tmp/podkit-pre-sync-sweep-src';
const VM_CONFIG_PATH = '/tmp/podkit-pre-sync-sweep-config.toml';
const DEVICE_NAME = 'sweep_target';
/**
 * Mass-storage layout for the generic preset:
 *   Music/{albumArtist}/{album}/{trackNumber} - {title}{ext}
 *
 * The seeded source uses the same default template so the destination
 * path is predictable for the `.podkit-tmp` poll.
 */
const ARTIST = 'Sweep Artist';
const ALBUM = 'Sweep Album';
const SHELL_ESCAPE_RE = /'/g;

function sq(value: string): string {
  return `'${value.replace(SHELL_ESCAPE_RE, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// VM helpers
// ---------------------------------------------------------------------------

async function runVm(
  command: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return limaTestVmRunner.run(command, { timeoutMs: VM_WARM_TIMEOUT_MS });
}

async function runVmRoot(
  command: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return limaTestVmRunner.run(`sudo sh -c ${sq(command)}`, { timeoutMs: VM_WARM_TIMEOUT_MS });
}

/**
 * Mount the echo-mini backing file at `VM_MOUNT_POINT`. The persona's
 * backing image is a single FAT32 partition without an MBR, so the raw
 * `/dev/sd<x>` node is the mount source.
 */
async function mountEchoMini(): Promise<string> {
  const findScript = [
    'for sg in /sys/class/scsi_generic/sg*; do',
    '  [ -e "$sg" ] || continue;',
    '  usb=$(readlink -f "$sg/device/../../../..");',
    '  [ -f "$usb/idVendor" ] || continue;',
    '  vid=$(cat "$usb/idVendor");',
    '  pid=$(cat "$usb/idProduct");',
    '  if [ "$vid" = "071b" ] && [ "$pid" = "3203" ]; then',
    '    blk=$(ls "$sg/device/block" 2>/dev/null | head -n1);',
    '    if [ -n "$blk" ]; then echo "$blk"; exit 0; fi;',
    '  fi;',
    'done;',
    'exit 1',
  ].join(' ');
  const find = await runVm(`sh -c ${sq(findScript)}`);
  if (find.exitCode !== 0 || !find.stdout.trim()) {
    throw new Error(
      `mountEchoMini: failed to find echo-mini /dev/sd* node (exit=${find.exitCode}, ` +
        `stdout="${find.stdout}", stderr="${find.stderr}")`
    );
  }
  const sd = find.stdout.trim();
  await runVmRoot(`mkdir -p ${VM_MOUNT_POINT}`);
  // FAT32 ignores chmod after the fact — the kernel synthesises uid/gid
  // from the mount options (default: owner=root, mode=0755). We mount
  // with the invoking user's numeric uid/gid + umask=000 so the non-root
  // podkit invocation can write. `iocharset=utf8` matches the production-
  // mount convention for podkit on FAT32 devices.
  //
  // The default Lima username varies across host setups (`lima` on most
  // hosts; the host's $USER on macOS via Lima's user-mode-host
  // convention), so we resolve the numeric IDs at runtime rather than
  // hard-coding a name that may not exist in the VM.
  const idProbe = await runVm('id -u && id -g');
  const [uidStr, gidStr] = idProbe.stdout.trim().split('\n');
  if (!uidStr || !gidStr) {
    throw new Error(`mountEchoMini: failed to resolve uid/gid (got '${idProbe.stdout}')`);
  }
  const mountOpts = `uid=${uidStr},gid=${gidStr},umask=000,iocharset=utf8`;
  const mount = await runVmRoot(`mount -t vfat -o ${mountOpts} /dev/${sd} ${VM_MOUNT_POINT}`);
  if (mount.exitCode !== 0) {
    // Try partition-suffixed source as a fallback (matches the doctor-
    // device-types pattern). The synthesised backing is unpartitioned
    // today, but a future variant may not be.
    const mountP1 = await runVmRoot(`mount -t vfat -o ${mountOpts} /dev/${sd}1 ${VM_MOUNT_POINT}`);
    if (mountP1.exitCode !== 0) {
      throw new Error(
        `mountEchoMini: failed to mount /dev/${sd} or /dev/${sd}1 at ${VM_MOUNT_POINT}: ` +
          `${mount.stderr.trim()} | ${mountP1.stderr.trim()}`
      );
    }
  }
  return sd;
}

async function unmountEchoMini(): Promise<void> {
  await runVmRoot(`umount ${VM_MOUNT_POINT} 2>/dev/null || true`).catch(() => {});
}

/**
 * Stage source tracks inside the VM via ffmpeg. We write two short MP3s
 * so the rename window is wide enough to catch reliably with the
 * poll-every-50ms loop. MP3 is direct-copy (no transcode), so the
 * `pre-rename-track` hook fires; FLAC + a transcode preset is staged for
 * the transcode scenario via {@link stageFlacSource}.
 */
async function stageMp3Source(): Promise<void> {
  // 4-second 440Hz sine tracks, MP3 @ 128k. Two tracks so a SIGKILL at
  // the first track's pause still leaves an unfinished sync visible.
  const script = `
set -eu
rm -rf ${sq(VM_SOURCE_DIR)}
mkdir -p ${sq(`${VM_SOURCE_DIR}/${ARTIST}/${ALBUM}`)}
for n in 01 02; do
  ffmpeg -y -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=4' \\
    -metadata artist=${sq(ARTIST)} -metadata album=${sq(ALBUM)} \\
    -metadata album_artist=${sq(ARTIST)} \\
    -metadata title="Track $n" -metadata track=$n \\
    -c:a libmp3lame -b:a 128k \\
    ${sq(`${VM_SOURCE_DIR}/${ARTIST}/${ALBUM}/`)}"$n Track $n.mp3" >/dev/null 2>&1
done
`;
  const r = await runVm(`bash -c ${sq(script)}`);
  if (r.exitCode !== 0) {
    throw new Error(`stageMp3Source failed (exit=${r.exitCode}): ${r.stderr.slice(0, 400)}`);
  }
}

/**
 * Stage a FLAC source so the music classifier routes through transcode
 * (lossless → AAC under the config below). Used by the transcode-tmp
 * scenarios.
 */
async function stageFlacSource(): Promise<void> {
  const script = `
set -eu
rm -rf ${sq(VM_SOURCE_DIR)}
mkdir -p ${sq(`${VM_SOURCE_DIR}/${ARTIST}/${ALBUM}`)}
ffmpeg -y -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=4' \\
  -metadata artist=${sq(ARTIST)} -metadata album=${sq(ALBUM)} \\
  -metadata album_artist=${sq(ARTIST)} \\
  -metadata title='Track 01' -metadata track=1 \\
  -c:a flac \\
  ${sq(`${VM_SOURCE_DIR}/${ARTIST}/${ALBUM}/01 Track 01.flac`)} >/dev/null 2>&1
`;
  const r = await runVm(`bash -c ${sq(script)}`);
  if (r.exitCode !== 0) {
    throw new Error(`stageFlacSource failed (exit=${r.exitCode}): ${r.stderr.slice(0, 400)}`);
  }
}

interface StageConfigOpts {
  /**
   * When `true`, force a transcode by setting the lossless lane to AAC.
   * When `false` (default), the direct-copy path is exercised.
   */
  transcode?: boolean;
}

async function stageConfig(opts: StageConfigOpts = {}): Promise<void> {
  const losslessLane = opts.transcode ? '["aac"]' : '["source"]';
  const body = `version = 2

quality = "max"
artwork = false

[codec]
lossy = ["aac"]
lossless = ${losslessLane}

[devices.${DEVICE_NAME}]
type = "generic"
path = "${VM_MOUNT_POINT}"
artworkSources = ["sidecar"]
supportedAudioCodecs = ["mp3", "aac"]
audioNormalization = "none"

[music.default]
path = "${VM_SOURCE_DIR}"

[defaults]
music = "default"
`;
  const r = await runVm(`cat > ${VM_CONFIG_PATH} << '__CFG_EOF__'\n${body}\n__CFG_EOF__`);
  if (r.exitCode !== 0) {
    throw new Error(`stageConfig failed (exit=${r.exitCode}): ${r.stderr.slice(0, 400)}`);
  }
}

// ---------------------------------------------------------------------------
// Background-process helpers
// ---------------------------------------------------------------------------

interface PausedSyncHandle {
  /** Spawned `limactl shell` child on the host. */
  child: ReturnType<typeof spawn>;
  /** Host-side promise that resolves once the child exits. */
  done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
}

/**
 * Spawn the debug podkit binary inside the VM with the supplied
 * `PODKIT_DEV_PAUSE_KEY`. The returned handle's `child.kill('SIGKILL')`
 * cleanly tears down the host-side `limactl shell` wrapper; the in-VM
 * podkit-debug process inherits the SIGHUP that limactl sends on its
 * own teardown.
 *
 * For deterministic in-VM teardown, callers run `pkill -KILL -f podkit-debug`
 * after observing the tmp artefact appear (see {@link killPodkitDebugInVm}).
 */
function spawnPausedSync(pauseKey: string): PausedSyncHandle {
  const inner =
    `PODKIT_DEV_PAUSE_KEY=${pauseKey} ` +
    `/usr/local/bin/podkit-debug --config ${VM_CONFIG_PATH} sync -d ${DEVICE_NAME}`;
  // `setsid` ensures the in-VM podkit-debug runs in its own process group
  // so `pkill` can target it cleanly without sweeping the limactl shell.
  const child = spawn('limactl', ['shell', LIMA_DEVICE_HARNESS_VM_NAME, '--', 'sh', '-c', inner], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((res) => {
    child.on('close', (code, signal) => {
      res({ exitCode: code, signal });
    });
  });
  return { child, done };
}

/**
 * SIGKILL the in-VM podkit-debug process by name. The host-side child
 * is the limactl shell, not podkit-debug itself; killing podkit-debug
 * in-VM is what we actually want (it severs the pause, leaves debris on
 * disk, and limactl exits when its inferior dies).
 */
async function killPodkitDebugInVm(): Promise<void> {
  // pkill exits 1 when no matches — treat as success since the process
  // may already be gone (raced with us).
  await runVm('pkill -KILL -f /usr/local/bin/podkit-debug || true');
}

// ---------------------------------------------------------------------------
// Poll helpers
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 50;
const POLL_TIMEOUT_MS = 30_000;

async function pollForOutput(
  vmCommand: string,
  predicate: (stdout: string) => boolean,
  context: string
): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const r = await runVm(vmCommand);
    if (predicate(r.stdout)) return r.stdout;
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
  throw new Error(
    `pollForOutput(${context}) timed out after ${POLL_TIMEOUT_MS}ms. ` + `Command: ${vmCommand}`
  );
}

/** Wait for at least one `.podkit-tmp` to appear under the mass-storage mount. */
async function waitForPodkitTmpUnder(mountPoint: string): Promise<string> {
  return pollForOutput(
    `find ${sq(mountPoint)} -name '*.podkit-tmp' -type f 2>/dev/null | head -1`,
    (out) => out.trim().length > 0,
    `${mountPoint}/**/*.podkit-tmp`
  );
}

/** Wait for at least one `podkit-transcode-<uuid>/` dir to appear under `/tmp`. */
async function waitForTranscodeDirUnder(tmpdirPath: string): Promise<string> {
  return pollForOutput(
    `find ${sq(tmpdirPath)} -maxdepth 1 -name 'podkit-transcode-*' -type d 2>/dev/null | head -1`,
    (out) => out.trim().length > 0,
    `${tmpdirPath}/podkit-transcode-*`
  );
}

// ---------------------------------------------------------------------------
// Production-binary sync invocations
// ---------------------------------------------------------------------------

interface SyncOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runSyncDryRun(): Promise<SyncOutput> {
  return runVm(`/usr/local/bin/podkit --config ${VM_CONFIG_PATH} sync -d ${DEVICE_NAME} --dry-run`);
}

async function runSync(): Promise<SyncOutput> {
  return runVm(`/usr/local/bin/podkit --config ${VM_CONFIG_PATH} sync -d ${DEVICE_NAME}`);
}

// ---------------------------------------------------------------------------
// Debug-binary availability gate
// ---------------------------------------------------------------------------

/**
 * Check the debug binary is available BOTH on the host (for diagnostic
 * surface) and at `/usr/local/bin/podkit-debug` inside the VM. When
 * missing, the suite skips rather than reports false failures — the
 * relevant turbo task (`@podkit/device-testing#build:linux-binary` +
 * `vm:install`) is responsible for shipping it.
 */
async function debugBinaryAvailable(): Promise<{ available: boolean; reason?: string }> {
  // Host-side existence is informational — the actual artefact under
  // test is the VM-side copy. We surface a clearer message when the
  // host binary is also missing (probably means the builder VM hasn't
  // run yet).
  try {
    await access(resolveDefaultPodkitDebugBinary());
  } catch {
    return {
      available: false,
      reason:
        'host-side podkit-debug binary missing; run `bunx turbo run ' +
        '@podkit/device-testing#build:linux-binary --force` to rebuild.',
    };
  }
  const vmProbe = await runVm('test -x /usr/local/bin/podkit-debug && echo ok || echo missing');
  if (!vmProbe.stdout.includes('ok')) {
    return {
      available: false,
      reason:
        'in-VM /usr/local/bin/podkit-debug missing; run `bun run harness:install` ' +
        'or `bunx turbo run @podkit/device-testing#vm:install --force`.',
    };
  }
  return { available: true };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('VM: pre-sync sweep SIGKILL round-trip', () => {
  let debugReady = false;
  let debugSkipReason: string | undefined;

  beforeAll(async () => {
    await limaTestVmRunner.prepare();
    await limaTestVmRunner.applyState(healthy);
    const probe = await debugBinaryAvailable();
    debugReady = probe.available;
    debugSkipReason = probe.reason;

    // Echo-mini daemon stays running across the whole suite — we mount
    // its backing file once and reuse for every scenario.
    await startDaemonForPersona({
      vmName: LIMA_DEVICE_HARNESS_VM_NAME,
      personaId: echoMini.id,
    });
    await waitForScsiGenericEnumeration({
      vmName: LIMA_DEVICE_HARNESS_VM_NAME,
      personaId: echoMini.id,
      timeoutMs: 5_000,
    });
    await mountEchoMini();
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    await killPodkitDebugInVm().catch(() => {});
    await unmountEchoMini();
    await runVm(`rm -rf ${VM_SOURCE_DIR} ${VM_CONFIG_PATH}`).catch(() => {});
    await runVm('rm -rf /tmp/podkit-transcode-* 2>/dev/null || true').catch(() => {});
    await stopDaemon({
      vmName: LIMA_DEVICE_HARNESS_VM_NAME,
      personaId: echoMini.id,
    }).catch(() => {});
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  // ─────────────────────────────────────────────────────────────────────────
  // AC #2 — mass-storage SIGKILL round-trip
  // ─────────────────────────────────────────────────────────────────────────

  it(
    'mass-storage: SIGKILL after .podkit-tmp lands → next sync surfaces cleanup line + state converges',
    async () => {
      if (!debugReady) {
        // Skip via early-return + a descriptive console line. Bun's
        // test runner doesn't expose a context.skip API; surface the
        // reason on stderr so a CI run that's missing the debug
        // binary leaves a breadcrumb instead of silently passing.
        // eslint-disable-next-line no-console
        console.warn(`[pre-sync-sweep] skipping: ${debugSkipReason ?? 'debug binary unavailable'}`);
        return;
      }

      // 1. Fresh source + clean mount.
      await runVmRoot(`find ${VM_MOUNT_POINT} -mindepth 1 -delete 2>/dev/null || true`);
      await stageMp3Source();
      await stageConfig();

      // 2. Spawn the paused sync (debug binary).
      const handle = spawnPausedSync('pre-rename-track');

      try {
        // 3. Poll for a `.podkit-tmp` to land under the mount.
        const tmpPath = (await waitForPodkitTmpUnder(VM_MOUNT_POINT)).trim();
        expect(tmpPath.endsWith('.podkit-tmp')).toBe(true);

        // 4. SIGKILL the in-VM podkit-debug. The host-side limactl
        //    shell exits on its own once the inferior dies.
        await killPodkitDebugInVm();
        await handle.done;
      } finally {
        // Belt-and-braces — if the test threw before kill, still tear down.
        await killPodkitDebugInVm().catch(() => {});
      }

      // 5. The debris must still be on disk after the kill. (If it
      //    isn't, the SIGKILL raced and the rename completed — flake.)
      const afterKill = await runVm(
        `find ${sq(VM_MOUNT_POINT)} -name '*.podkit-tmp' -type f 2>/dev/null | wc -l`
      );
      expect(parseInt(afterKill.stdout.trim(), 10)).toBeGreaterThanOrEqual(1);

      // 6. Dry-run reports the cleanup. We assert the exact-shape
      //    sentinel emitted by sync.ts ("Would clean N incomplete-write
      //    file(s)…"); the count substring lets the test tolerate the
      //    multi-tmp case if the pause races into the second track.
      const dry = await runSyncDryRun();
      expect(dry.stdout).toMatch(
        /Would clean \d+ incomplete-write files? \([^)]+\) from a previous interrupted sync/
      );

      // 7. Real sync reaps the debris + converges (both source tracks
      //    land at their final paths). Production binary — no pause env.
      const realSync = await runSync();
      expect(realSync.exitCode).toBe(0);

      const debrisAfter = await runVm(
        `find ${sq(VM_MOUNT_POINT)} -name '*.podkit-tmp' -type f 2>/dev/null | wc -l`
      );
      expect(parseInt(debrisAfter.stdout.trim(), 10)).toBe(0);

      const finalCount = await runVm(
        `find ${sq(VM_MOUNT_POINT)} -name '*.mp3' -type f 2>/dev/null | wc -l`
      );
      expect(parseInt(finalCount.stdout.trim(), 10)).toBe(2);
    },
    VM_COLD_TIMEOUT_MS
  );

  // ─────────────────────────────────────────────────────────────────────────
  // AC #3 — iPod SIGKILL (synthetic-debris variant — permanent)
  //
  // The iPod adapter does not use podkit's atomic-write helper for any of
  // its on-disk writes today. iTunesDB / ArtworkDB writes go through
  // libgpod which uses GLib's `g_file_set_contents` (random `.tmpXXXXXX`
  // suffix, not `.podkit-tmp`). Track files are added through libgpod's
  // copy-and-register path, not through `atomicCopyFile`. So no current
  // code path under `iPod_Control/` produces `.podkit-tmp` debris on
  // crash — the `debris-files-ipod` walker exists to catch future writes,
  // not anything written today.
  //
  // The synthetic-debris approach below is therefore PERMANENT, not a
  // workaround pending another task. It exercises the same sweep code
  // path the walker would surface for any future iPod write that adopted
  // the shared atomic helper. If/when an iPod write path is retrofitted
  // to use `atomicCopyFile` / `atomicWriteFile`, a real-SIGKILL variant
  // can be added alongside this one.
  // ─────────────────────────────────────────────────────────────────────────

  it(
    'iPod (synthetic): planted .podkit-tmp under iPod_Control/ is surfaced by the next dry-run',
    async () => {
      // Reuse the same FAT32 mount — initialise it as an iPod via the
      // gpod-tool helper. The pre-sync sweep runs AFTER `IpodDatabase.open`
      // succeeds (sync.ts gates the sweep on a parseable iTunesDB),
      // so we need a real iTunesDB on disk — a bare iPod_Control/Music/F00
      // tree would short-circuit before the walker runs.
      await runVmRoot(`find ${VM_MOUNT_POINT} -mindepth 1 -delete 2>/dev/null || true`);

      // Real gpod-tool init creates a complete iTunesDB at a low-end
      // model. Choose the iPod video 5g (MA002) since the existing
      // VM harness already uses it for other scenarios.
      const gpod = await runVm(
        `/usr/local/bin/gpod-tool init ${sq(VM_MOUNT_POINT)} --model MA002 2>&1`
      );
      if (gpod.exitCode !== 0) {
        throw new Error(
          `gpod-tool init failed (exit=${gpod.exitCode}): ${gpod.stdout}${gpod.stderr}`
        );
      }

      // Plant a `.podkit-tmp` next to where a track would live. This
      // simulates "any future iPod write path adopted atomicCopyFile and
      // was SIGKILLed between tmp and rename". No iPod path produces this
      // pattern today (libgpod uses random `.tmpXXXXXX` suffixes); the
      // synthetic plant exercises the same sweep code that would surface
      // real debris if such a path landed.
      const plantedTmp = `${VM_MOUNT_POINT}/iPod_Control/Music/F00/SWPK.mp3.podkit-tmp`;
      await runVmRoot(`mkdir -p ${VM_MOUNT_POINT}/iPod_Control/Music/F00`);
      await runVmRoot(`printf 'planted-debris' > ${sq(plantedTmp)}`);

      // Source: empty config-pointed dir — sync would otherwise no-op
      // and never reach the sweep.
      await runVm(`rm -rf ${VM_SOURCE_DIR} && mkdir -p ${VM_SOURCE_DIR}`);

      // Config: address the device by name with `type = "ipod"` so the
      // resolver treats this mount as iPod (matching the by-name path
      // in doctor-device-types.e2e.test.ts).
      const ipodConfig = `version = 2

[devices.${DEVICE_NAME}]
type = "ipod"
path = "${VM_MOUNT_POINT}"

[music.default]
path = "${VM_SOURCE_DIR}"

[defaults]
music = "default"
`;
      await runVm(`cat > ${VM_CONFIG_PATH} << '__CFG_EOF__'\n${ipodConfig}\n__CFG_EOF__`);

      const dry = await runSyncDryRun();

      // Expect the cleanup line. The iPod walker counts the planted
      // tmp as debris.
      expect(dry.stdout + dry.stderr).toMatch(
        /Would clean \d+ incomplete-write files? \([^)]+\) from a previous interrupted sync/
      );

      // Cleanup: unlink the planted tmp so the next scenario starts
      // clean. (afterAll also blasts the mount, but a per-test cleanup
      // is cheaper than re-mounting.)
      await runVmRoot(`rm -f ${sq(plantedTmp)}`);
    },
    VM_COLD_TIMEOUT_MS
  );

  // ─────────────────────────────────────────────────────────────────────────
  // AC #4 — transcode-tmp SIGKILL round-trip
  // ─────────────────────────────────────────────────────────────────────────

  it(
    'transcode: SIGKILL after podkit-transcode-<uuid>/ exists → next sync reaps + cleanup line includes it',
    async () => {
      if (!debugReady) {
        // eslint-disable-next-line no-console
        console.warn(`[pre-sync-sweep] skipping: ${debugSkipReason ?? 'debug binary unavailable'}`);
        return;
      }

      // 1. Fresh source + mount. FLAC + transcode-only lossless lane.
      await runVmRoot(`find ${VM_MOUNT_POINT} -mindepth 1 -delete 2>/dev/null || true`);
      await runVm('rm -rf /tmp/podkit-transcode-* 2>/dev/null || true');
      await stageFlacSource();
      await stageConfig({ transcode: true });

      // 2. Paused sync, debug binary, transcode pause key.
      const handle = spawnPausedSync('pre-rename-transcode');

      let transcodeDirPath = '';
      try {
        const found = (await waitForTranscodeDirUnder('/tmp')).trim();
        expect(found.startsWith('/tmp/podkit-transcode-')).toBe(true);
        transcodeDirPath = found;
        await killPodkitDebugInVm();
        await handle.done;
      } finally {
        await killPodkitDebugInVm().catch(() => {});
      }

      // 3. The orphan dir must persist past the kill. Its `.owner` file
      //    references a now-dead pid, so the next sweep reaps it.
      const stillThere = await runVm(`test -d ${sq(transcodeDirPath)} && echo ok || echo gone`);
      expect(stillThere.stdout.trim()).toBe('ok');

      // 4. Dry-run reports the cleanup. The line counts the orphan
      //    dir among the debris paths.
      const dry = await runSyncDryRun();
      expect(dry.stdout).toMatch(
        /Would clean \d+ incomplete-write files? \([^)]+\) from a previous interrupted sync/
      );

      // 5. Real sync converges. The transcode dir is gone after.
      const realSync = await runSync();
      expect(realSync.exitCode).toBe(0);
      const orphanCount = await runVm(
        `find /tmp -maxdepth 1 -name 'podkit-transcode-*' -type d 2>/dev/null | wc -l`
      );
      // The real sync creates its OWN podkit-transcode dir during
      // execution and tears it down in its finally{} block. By the
      // time `podkit sync` exits, no transcode dirs should be left.
      expect(parseInt(orphanCount.stdout.trim(), 10)).toBe(0);
    },
    VM_COLD_TIMEOUT_MS
  );

  // ─────────────────────────────────────────────────────────────────────────
  // AC #5 — concurrent-process safety
  //
  // A live podkit-debug holding the `pre-rename-transcode` pause has a
  // valid `.owner` file pointing at its still-alive PID. A sibling
  // `podkit sync --dry-run` invoked in parallel MUST NOT reap that dir
  // — the walker's PID-liveness probe (TASK-402) is the safety floor.
  // ─────────────────────────────────────────────────────────────────────────

  it(
    'concurrent-process safety: a live podkit holding pre-rename-transcode pause is NOT reaped by a sibling sweep',
    async () => {
      if (!debugReady) {
        // eslint-disable-next-line no-console
        console.warn(`[pre-sync-sweep] skipping: ${debugSkipReason ?? 'debug binary unavailable'}`);
        return;
      }

      // 1. Fresh state.
      await runVmRoot(`find ${VM_MOUNT_POINT} -mindepth 1 -delete 2>/dev/null || true`);
      await runVm('rm -rf /tmp/podkit-transcode-* 2>/dev/null || true');
      await stageFlacSource();
      await stageConfig({ transcode: true });

      // 2. Start the live (paused) sync.
      const handle = spawnPausedSync('pre-rename-transcode');

      let liveDir = '';
      try {
        liveDir = (await waitForTranscodeDirUnder('/tmp')).trim();
        expect(liveDir.startsWith('/tmp/podkit-transcode-')).toBe(true);

        // 3. With the live sync STILL paused, run a sibling dry-run.
        //    Production binary; no pause env. This invokes the sweep,
        //    which walks /tmp for podkit-transcode-*. The PID-liveness
        //    probe (transcode-tmp-walker.ts: `isAlive(owner)`) must
        //    skip the live dir.
        const siblingDry = await runSyncDryRun();
        // The sibling's stdout may or may not contain the cleanup
        // line depending on whether non-live debris exists (it
        // doesn't, in this test — only the live dir). The critical
        // assertion is that the live dir is STILL present after the
        // sibling exits.
        void siblingDry;

        const stillLive = await runVm(`test -d ${sq(liveDir)} && echo ok || echo reaped`);
        expect(stillLive.stdout.trim()).toBe('ok');
      } finally {
        // Tear down the live process.
        await killPodkitDebugInVm().catch(() => {});
        await handle.done.catch(() => {});
        // Post-kill, the dir's .owner is now dead — a follow-up
        // sweep WOULD reap. Clean up explicitly so the next test
        // doesn't inherit it.
        await runVm('rm -rf /tmp/podkit-transcode-* 2>/dev/null || true').catch(() => {});
      }
    },
    VM_COLD_TIMEOUT_MS
  );
});
