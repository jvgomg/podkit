/**
 * Unit tests for the persona sidecar schema.
 *
 * Round-trip + validation coverage. No filesystem, no kernel — pure data.
 */

import { describe, it, expect } from 'bun:test';

import type { DevicePersona } from './types.js';
import { SIDECAR_SCHEMA_VERSION, parseHexId, parseSidecar, serializeSidecar } from './sidecar.js';
import { buildSidecar, toSidecarPersona } from './sidecar-build.js';

const baseUsb = {
  vendorId: 0x05ac,
  productId: 0x1209,
  deviceSerial: '000A27001605D1A0' as string | null,
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
};

function makeIpod(overrides: Partial<DevicePersona> = {}): DevicePersona {
  return {
    id: 'ipod-test',
    description: 'test persona',
    schemaVersion: 2,
    usbDescriptor: { ...baseUsb },
    sysInfoExtendedXml: '<plist><dict><key>foo</key><string>bar</string></dict></plist>',
    lsblkJson: null,
    systemProfilerJson: null,
    diskutilPlist: null,
    partitionLayout: { luns: [{ lun: 0, partitions: [] }] },
    massStorageBackingFile: null,
    expectedCapabilities: null,
    expectedReadiness: { level: 'ready', stages: [] },
    expectedDoctorOutput: {},
    provenance: { provenanceDoc: './provenance.md', source: 'physical-capture' },
    ...overrides,
  };
}

function makeMassStorage(overrides: Partial<DevicePersona> = {}): DevicePersona {
  return makeIpod({
    id: 'echo-test',
    sysInfoExtendedXml: null,
    massStorageBackingFile: { imagePath: './backing.img', resetStrategy: 'copy' },
    ...overrides,
  });
}

describe('toSidecarPersona', () => {
  it('projects iPod persona xml + descriptor', () => {
    const out = toSidecarPersona(makeIpod());
    expect(out).not.toBeNull();
    expect(out!.id).toBe('ipod-test');
    expect(out!.usbDescriptor.vendorId).toBe('0x05ac');
    expect(out!.usbDescriptor.productId).toBe('0x1209');
    expect(out!.sysInfoExtendedXml).toContain('<plist>');
    expect(out!.massStorageBackingFile).toBeUndefined();
  });

  it('emits mass-storage block when backing file is staged', () => {
    const out = toSidecarPersona(makeMassStorage(), '/var/device-testing/backing.img');
    expect(out).not.toBeNull();
    expect(out!.sysInfoExtendedXml).toBeUndefined();
    expect(out!.massStorageBackingFile).toEqual({
      vmPath: '/var/device-testing/backing.img',
      resetStrategy: 'copy',
    });
  });

  it('returns null when neither xml nor backing path is present', () => {
    // mass-storage persona configured in TS but runner has not staged a path
    const out = toSidecarPersona(makeMassStorage());
    expect(out).toBeNull();
  });

  it('returns null for fully-empty personas', () => {
    const persona = makeIpod({ sysInfoExtendedXml: null, massStorageBackingFile: null });
    expect(toSidecarPersona(persona)).toBeNull();
  });

  it('pads small vendor/product ids', () => {
    const out = toSidecarPersona(
      makeIpod({ usbDescriptor: { ...baseUsb, vendorId: 0x1, productId: 0x10 } })
    );
    expect(out!.usbDescriptor.vendorId).toBe('0x0001');
    expect(out!.usbDescriptor.productId).toBe('0x0010');
  });

  it('omits the sidecar serial field when persona.deviceSerial is null', () => {
    // TASK-332 v2 schema: Sony NW-HD5-style devices set deviceSerial=null
    // (iSerialNumber=0). The sidecar serialiser must omit the `serial`
    // field rather than writing `null` so the daemon's optional-string
    // default kicks in.
    const out = toSidecarPersona(makeIpod({ usbDescriptor: { ...baseUsb, deviceSerial: null } }));
    expect(out).not.toBeNull();
    expect(out!.usbDescriptor.serial).toBeUndefined();
  });
});

describe('buildSidecar', () => {
  it('keys personas by id and skips daemon-irrelevant entries', () => {
    const sidecar = buildSidecar(
      [makeIpod(), makeMassStorage(), makeIpod({ id: 'orphan', sysInfoExtendedXml: null })],
      new Map([['echo-test', '/var/device-testing/backing.img']])
    );
    expect(sidecar.schemaVersion).toBe(SIDECAR_SCHEMA_VERSION);
    expect(Object.keys(sidecar.personas).sort()).toEqual(['echo-test', 'ipod-test']);
  });
});

describe('serializeSidecar + parseSidecar', () => {
  it('round-trips an iPod sidecar payload', () => {
    const sidecar = buildSidecar([makeIpod()]);
    const json = serializeSidecar(sidecar);
    const parsed = parseSidecar(json);
    expect(parsed).toEqual(sidecar);
  });

  it('round-trips a mixed payload with mass-storage backing file', () => {
    const sidecar = buildSidecar(
      [makeIpod(), makeMassStorage()],
      new Map([['echo-test', '/var/device-testing/backing.img']])
    );
    const json = serializeSidecar(sidecar);
    const parsed = parseSidecar(json);
    expect(parsed).toEqual(sidecar);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseSidecar('not json')).toThrow(/invalid JSON/);
  });

  it('rejects an unsupported schema version', () => {
    expect(() => parseSidecar(JSON.stringify({ schemaVersion: 99, personas: {} }))).toThrow(
      /not supported/
    );
  });

  it('rejects a non-object personas field', () => {
    expect(() => parseSidecar(JSON.stringify({ schemaVersion: 1, personas: [] }))).toThrow(
      /must be an object/
    );
  });

  it('rejects a persona with a malformed vendor id', () => {
    const broken = {
      schemaVersion: 1,
      personas: {
        bad: {
          id: 'bad',
          description: 'x',
          usbDescriptor: { vendorId: '1234', productId: '0x1209' },
        },
      },
    };
    expect(() => parseSidecar(JSON.stringify(broken))).toThrow(/vendorId is not a hex string/);
  });

  it('rejects a persona with an invalid reset strategy', () => {
    const broken = {
      schemaVersion: 1,
      personas: {
        bad: {
          id: 'bad',
          description: 'x',
          usbDescriptor: { vendorId: '0x05ac', productId: '0x1209' },
          massStorageBackingFile: { vmPath: '/x', resetStrategy: 'nope' },
        },
      },
    };
    expect(() => parseSidecar(JSON.stringify(broken))).toThrow(/resetStrategy/);
  });
});

describe('parseHexId', () => {
  it('parses hex strings back to numbers', () => {
    expect(parseHexId('0x05ac')).toBe(0x05ac);
    expect(parseHexId('0x1209')).toBe(0x1209);
  });

  it('rejects non-hex strings', () => {
    expect(() => parseHexId('1234')).toThrow();
    expect(() => parseHexId('05ac')).toThrow();
  });
});
