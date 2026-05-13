import { describe, it, expect } from 'bun:test';
import { personas, systemStates, getRunner, listRunners, type DevicePersona } from './index.js';

describe('@podkit/device-testing scaffold', () => {
  it('exposes an empty personas Map', () => {
    expect(personas).toBeInstanceOf(Map);
    expect(personas.size).toBe(0);
  });

  it('exposes a populated systemStates Map', () => {
    expect(systemStates).toBeInstanceOf(Map);
    expect(systemStates.size).toBe(6);
  });

  it('auto-registers the local-linux runner', () => {
    const runner = getRunner('local-linux');
    expect(runner).toBeDefined();
    expect(runner?.id).toBe('local-linux');
    expect(listRunners().map((r) => r.id)).toContain('local-linux');
  });

  it('getRunner returns undefined for an unregistered id', () => {
    expect(getRunner('lima-test-vm')).toBeUndefined();
    expect(listRunners().length).toBe(1);
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
      schemaVersion: 1,
      usbDescriptor: {
        vendorId: 0x05ac,
        productId: 0x1261,
        deviceSerial: '0000',
        deviceClass: 0,
        deviceSubclass: 0,
        deviceProtocol: 0,
      },
      sysInfoExtendedXml: null,
      lsblkJson: null,
      systemProfilerJson: null,
      diskutilPlist: null,
      partitionLayout: { partitions: [] },
      massStorageBackingFile: null,
      expectedCapabilities: null,
      expectedReadiness: { level: 'unknown', stages: [] },
      expectedDoctorOutput: {},
      provenance: {
        provenanceDoc: 'docs/personas/fixture-test-only.md',
        source: 'synthesised',
      },
    };
    expect(sample.id).toBe('fixture-test-only');
  });
});
