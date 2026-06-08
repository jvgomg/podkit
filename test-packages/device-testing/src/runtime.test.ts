import { describe, it, expect } from 'bun:test';
import { personas, systemStates, getRunner, listRunners, type DevicePersona } from './index.js';

describe('@podkit/device-testing scaffold', () => {
  it('exposes a populated personas Map', () => {
    expect(personas).toBeInstanceOf(Map);
    expect(personas.size).toBeGreaterThan(0);
    expect(personas.has('ipod-mini-2g-pink')).toBe(true);
  });

  it('exposes a populated systemStates Map', () => {
    expect(systemStates).toBeInstanceOf(Map);
    expect(systemStates.size).toBe(9);
  });

  it('auto-registers the local-linux runner', () => {
    const runner = getRunner('local-linux');
    expect(runner).toBeDefined();
    expect(runner?.id).toBe('local-linux');
    expect(listRunners().map((r) => r.id)).toContain('local-linux');
  });

  it('auto-registers the lima-test-vm runner', () => {
    const runner = getRunner('lima-test-vm');
    expect(runner).toBeDefined();
    expect(runner?.id).toBe('lima-test-vm');
    expect(listRunners().map((r) => r.id)).toContain('lima-test-vm');
  });

  it('getRunner returns undefined for an unregistered id', () => {
    expect(getRunner('does-not-exist')).toBeUndefined();
    expect(listRunners().length).toBe(2);
  });

  it('local-linux isAvailable reflects host platform', async () => {
    const runner = getRunner('local-linux');
    const available = await runner!.isAvailable();
    expect(available).toBe(process.platform === 'linux');
  });

  it.skipIf(process.platform !== 'linux')(
    'local-linux runs a command and captures stdout',
    async () => {
      const runner = getRunner('local-linux');
      await runner!.prepare();
      const result = await runner!.run('echo hi');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hi');
      await runner!.teardown();
    }
  );

  it('DevicePersona type is consumable from a literal', () => {
    const sample: DevicePersona = {
      id: 'fixture-test-only',
      description: 'fixture for type-check smoke test',
      schemaVersion: 3,
      usbDescriptor: {
        vendorId: 0x05ac,
        productId: 0x1261,
        deviceSerial: '0000',
        deviceClass: 0,
        deviceSubclass: 0,
        deviceProtocol: 0,
        bMaxPacketSize0: 64,
        bcdUSB: 0x0200,
        bcdDevice: 0x0001,
        bNumConfigurations: 1,
        configurations: [
          {
            bConfigurationValue: 1,
            bNumInterfaces: 1,
            bmAttributes: 0x80,
            bMaxPower: 0xfa,
            interfaces: [
              {
                bInterfaceNumber: 0,
                bAlternateSetting: 0,
                bInterfaceClass: 0x08,
                bInterfaceSubClass: 0x06,
                bInterfaceProtocol: 0x50,
                endpoints: [],
              },
            ],
          },
        ],
        stringDescriptors: {},
      },
      sysInfoExtendedXml: null,
      lsblkJson: null,
      systemProfilerJson: null,
      diskutilPlist: null,
      partitionLayout: { luns: [{ lun: 0, partitions: [] }] },
      massStorageBackingFile: null,
      provenance: {
        provenanceDoc: 'docs/personas/fixture-test-only.md',
        source: 'synthesised',
      },
    };
    expect(sample.id).toBe('fixture-test-only');
  });
});
