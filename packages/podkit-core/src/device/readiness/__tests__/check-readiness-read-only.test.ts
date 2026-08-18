/**
 * `checkReadiness()` on a read-only generation.
 *
 * A `read-only` generation (shuffle 3G/4G, nano 6G/7G) refuses writes but
 * reads its `iTunesDB` fine. The cascade's unsupported short-circuit is
 * therefore intent-dependent: a write caller (sync, init) is refused up
 * front, while a read caller (doctor's diagnostics) runs the whole cascade
 * — every stage probe is a `stat`, a file read, or a libgpod parse.
 *
 * `access: 'none'` generations (iPod touch, iPhone) are refused for both
 * intents: there is no disk representation to read.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { checkReadiness } from '../index.js';
import type { PlatformDeviceInfo } from '../../types.js';
import type { DiscoveredDeviceIpod } from '../../discovery.js';
import type { IpodClassification } from '@podkit/devices-ipod';
import { classifyAsIpod } from '@podkit/devices-ipod';
import type { EnumeratedUsbDevice } from '../../usb-enumeration.js';

/** nano 7G — `read-only`: libgpod parses its database, hashAB signing is unavailable. */
const NANO_7G_PID = '120e';
/** iPod touch 5G — `none`: no disk mode at all. */
const TOUCH_5G_PID = '12aa';

/**
 * Build the classification the discovery reconciler would attach, using the
 * production classifier so the `model` (and therefore the access tier the
 * cascade resolves) comes from the real generation tables.
 */
function classify(productId: string): IpodClassification<EnumeratedUsbDevice> {
  const classification = classifyAsIpod<EnumeratedUsbDevice>({ vendorId: '05ac', productId });
  if (!classification) throw new Error(`classifyAsIpod returned null for PID ${productId}`);
  return classification;
}

function makeArm(
  mountPoint: string,
  usb: IpodClassification<EnumeratedUsbDevice> | undefined
): DiscoveredDeviceIpod {
  const block: PlatformDeviceInfo = {
    identifier: 'disk9s2',
    volumeName: 'LAPTOPS IP',
    volumeUuid: 'READ-ONLY-UUID',
    storage: { sizeBytes: 16_000_000_000 },
    isMounted: true,
    mountPoint,
  };
  return {
    kind: 'ipod',
    block,
    ...(usb ? { usb } : {}),
    matchedBy: usb ? 'serial' : 'block-only',
  };
}

describe('checkReadiness() — read-only generations', () => {
  let mountPoint: string;

  beforeEach(() => {
    mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-readiness-read-only-'));
    // Minimal iPod layout so the mount stage passes and the cascade can
    // reach sysinfo / database. D476 = iPod nano (7th generation).
    const deviceDir = path.join(mountPoint, 'iPod_Control', 'Device');
    fs.mkdirSync(deviceDir, { recursive: true });
    fs.mkdirSync(path.join(mountPoint, 'iPod_Control', 'Music'), { recursive: true });
    fs.writeFileSync(path.join(deviceDir, 'SysInfo'), 'ModelNumStr: D476\n', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(mountPoint, { recursive: true, force: true });
  });

  it('runs the whole cascade for a read intent instead of refusing up front', async () => {
    const result = await checkReadiness({
      device: makeArm(mountPoint, classify(NANO_7G_PID)),
      requiredAccess: 'read',
    });

    expect(result.level).not.toBe('unsupported');
    // Every stage up to the database actually ran — none of them is a
    // "skipped, previous check failed" placeholder.
    const byStage = new Map(result.stages.map((s) => [s.stage, s]));
    expect(byStage.get('usb')?.status).toBe('pass');
    expect(byStage.get('partition')?.status).toBe('pass');
    expect(byStage.get('filesystem')?.status).toBe('pass');
    expect(byStage.get('mount')?.status).not.toBe('skip');
    expect(byStage.get('sysinfo')?.status).not.toBe('skip');
    expect(byStage.get('database')?.status).not.toBe('skip');
    // The read-only tier is still discoverable by the caller — the model
    // carries the rejection reason even though the cascade continued.
    expect(result.usbModel?.generationId).toBe('nano_7g');
    expect(result.usbModel?.unsupportedReason?.headline).toContain('nano 7th gen');
  });

  it('refuses a read-only generation for a write intent (the default)', async () => {
    const result = await checkReadiness({
      device: makeArm(mountPoint, classify(NANO_7G_PID)),
    });

    expect(result.level).toBe('unsupported');
    expect(result.stages[0]?.status).toBe('fail');
    for (let i = 1; i < result.stages.length; i++) {
      expect(result.stages[i]?.status).toBe('skip');
    }
  });

  it('refuses an access-tier-none generation even for a read intent', async () => {
    const result = await checkReadiness({
      device: makeArm(mountPoint, classify(TOUCH_5G_PID)),
      requiredAccess: 'read',
    });

    expect(result.level).toBe('unsupported');
    expect(result.unsupported?.kind).toBe('ios-device');
    expect(result.stages[0]?.status).toBe('fail');
  });

  it('runs past the post-sysinfo refusal for a read intent on the block-only path', async () => {
    // No USB classification — the path-mode fallback doctor uses. The
    // generation is resolved from SysInfo's ModelNumStr instead, and the
    // post-sysinfo short-circuit is the one that has to soften.
    const result = await checkReadiness({
      device: makeArm(mountPoint, undefined),
      requiredAccess: 'read',
    });

    expect(result.deviceModel?.generationId).toBe('nano_7g');
    expect(result.level).not.toBe('unsupported');
    const byStage = new Map(result.stages.map((s) => [s.stage, s]));
    // The database stage ran for real: no libgpod-parsable database exists in
    // the fixture, so it reports a failure rather than a skip placeholder.
    expect(byStage.get('database')?.status).toBe('fail');
  });

  it('keeps refusing the block-only path for a write intent', async () => {
    const result = await checkReadiness({ device: makeArm(mountPoint, undefined) });

    expect(result.level).toBe('unsupported');
    const byStage = new Map(result.stages.map((s) => [s.stage, s]));
    expect(byStage.get('database')?.status).toBe('skip');
  });
});
