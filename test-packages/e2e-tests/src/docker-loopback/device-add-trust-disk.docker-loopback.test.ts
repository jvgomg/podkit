/**
 * E2E · `host-docker-image` · `local-dir` · `loopback-fat` — the shipped image
 * driving the **podkit CLI** against a real loopback FAT block device, VM-free.
 * (doc-053 Tier-4; taxonomy: documents/architecture/testing/taxonomy.md)
 *
 * # Why this is a CLI surface, not a daemon one
 *
 * The daemon's iPod poller is deliberately USB-gated — it excludes `loop`-type
 * devices and requires an Apple USB vendor id from `/sys`
 * (`packages/podkit-daemon/src/device-poller.ts`), so it can only ever sync
 * provably-real iPods. A loopback FAT can never trigger daemon detection, so
 * daemon detect→mount→sync→eject + SIGTERM + notify live only in the VM
 * (`vm-docker-image` · `usb-synth`, task-474). What a loopback *can* honestly
 * prove is the transport-agnostic CLI operating on a mounted iPod filesystem via
 * on-disk identity — no USB. See task-450.
 *
 * # What it owns
 *
 * The `device add` **`--no-verify` (trust-disk)** verification tier against a
 * mounted iPod volume — the case `src/docker-source/device-add.test.ts`
 * documents as blocked "until the harness can mount a synthetic iPod volume" —
 * plus **hard-error-on-generic** (`device add` in detect mode against a generic
 * FAT lacking authoritative identity → refuse, never mutate). The default
 * `verified` tier needs USB/SCSI firmware inquiry → stays VM-only (doc-046).
 *
 * # Running locally
 *
 *   bun run test:e2e:docker-loopback
 *
 * Requires Docker (a `--privileged` container for `losetup`/`mkfs.vfat`) and the
 * musl binaries (turbo dep `@podkit/device-testing#build:musl-binary`; if run
 * ad-hoc and missing, `bunx turbo run build:musl-binary --filter
 * @podkit/device-testing`). Excluded from the default e2e run via the
 * `docker-loopback/` surface-dir exclusion.
 *
 * @tags docker
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { ensurePodkitImageOnHost } from '../docker/podkit-image.js';
import { isDockerAvailable } from '../sources/subsonic.js';
import {
  startLoopbackContainer,
  seedIpodLoopback,
  seedGenericLoopback,
  runPodkitJson,
  type LoopbackContainer,
} from './harness.js';

/** JSON success envelope from `podkit device add --json`. Mirrors DeviceAddSuccess. */
interface DeviceAddJson {
  success: boolean;
  code?: string;
  error?: string;
  device?: { name: string; [k: string]: unknown };
  saved?: boolean;
  verification?: 'verified' | 'trusted-disk' | 'config-only';
}

// Reassigned in beforeAll: the local build keeps this tag; a pull (when
// PODKIT_DOCKER_DIST_IMAGE is set) resolves to the pulled registry tag.
let IMAGE_TAG = 'podkit:loopback-test';
const BUILD_TIMEOUT_MS = 300_000;
const CASE_TIMEOUT_MS = 60_000;

let container: LoopbackContainer;

beforeAll(async () => {
  if (!(await isDockerAvailable())) {
    throw new Error(
      'Docker is not available — required for the docker-loopback suite. Start Docker and run `bun run test:e2e:docker-loopback`.'
    );
  }
  IMAGE_TAG = await ensurePodkitImageOnHost({ tag: IMAGE_TAG });
  container = await startLoopbackContainer(IMAGE_TAG);
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
  await container?.stop();
});

describe('podkit device add --no-verify (trust-disk) against a loopback FAT iPod', () => {
  it(
    'trusts on-disk SysInfoExtended and adds the device (exit 0, verification = trusted-disk)',
    async () => {
      const mp = '/ipod-present';
      const cfg = '/tmp/config-present.toml';
      await seedIpodLoopback(container, { mountPoint: mp, withSysInfoExtended: true });

      const { exitCode, json } = await runPodkitJson<DeviceAddJson>(container, [
        '--config',
        cfg,
        '--device',
        'trustpod',
        'device',
        'add',
        '--type',
        'ipod',
        '--no-verify',
        '--path',
        mp,
        '--yes',
      ]);

      expect(exitCode).toBe(0);
      expect(json).not.toBeNull();
      expect(json!.success).toBe(true);
      expect(json!.verification).toBe('trusted-disk');
      expect(json!.device?.name).toBe('trustpod');

      // Device row persisted.
      const config = await container.exec(`cat ${cfg}`);
      expect(config.stdout).toContain('[devices.trustpod]');
    },
    CASE_TIMEOUT_MS
  );

  it(
    'refuses when on-disk SysInfoExtended is absent, pointing at doctor (exit 1, no mutation)',
    async () => {
      const mp = '/ipod-missing';
      const cfg = '/tmp/config-missing.toml';
      await seedIpodLoopback(container, { mountPoint: mp, withSysInfoExtended: false });

      const { exitCode, json } = await runPodkitJson<DeviceAddJson>(container, [
        '--config',
        cfg,
        '--device',
        'nosie',
        'device',
        'add',
        '--type',
        'ipod',
        '--no-verify',
        '--path',
        mp,
        '--yes',
      ]);

      expect(exitCode).toBe(1);
      expect(json).not.toBeNull();
      expect(json!.success).toBe(false);
      expect(json!.code).toBe('EMPTY_IDENTITY');
      // Trust-disk-specific hint: run doctor (which performs the USB inquiry).
      expect(json!.error).toContain('podkit doctor');

      // Never mutated: the config file was not even created.
      const exists = await container.exec(`test -f ${cfg} && echo EXISTS || echo NONE`);
      expect(exists.stdout.trim()).toBe('NONE');
    },
    CASE_TIMEOUT_MS
  );
});

describe('podkit device add against a generic FAT (hard-error-on-generic)', () => {
  it(
    'refuses a device with no identifying signal in detect mode (exit 1, never mutates)',
    async () => {
      const mp = '/generic-stick';
      const cfg = '/tmp/config-generic.toml';
      await seedGenericLoopback(container, { mountPoint: mp });

      // Detect mode (NO --type): a generic FAT has no authoritative identity.
      // (A declared `--type ipod` claim would proceed by design — not the case
      // under test here.)
      const { exitCode, json } = await runPodkitJson<DeviceAddJson>(container, [
        '--config',
        cfg,
        '--device',
        'stick',
        'device',
        'add',
        '--no-verify',
        '--path',
        mp,
        '--yes',
      ]);

      expect(exitCode).toBe(1);
      expect(json).not.toBeNull();
      expect(json!.success).toBe(false);
      expect(json!.code).toBe('EMPTY_IDENTITY');
      expect(json!.error).toContain('no identifying signal');

      // Never mutated: the config file was not created, and no iPod filesystem
      // was written to the stick.
      const exists = await container.exec(`test -f ${cfg} && echo EXISTS || echo NONE`);
      expect(exists.stdout.trim()).toBe('NONE');
      const tree = await container.exec(`ls ${mp}`);
      expect(tree.stdout).not.toContain('iPod_Control');
    },
    CASE_TIMEOUT_MS
  );
});
