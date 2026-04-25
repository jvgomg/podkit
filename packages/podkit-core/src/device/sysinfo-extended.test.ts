import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ensureSysInfoExtended,
  readSysInfoExtended,
  type ReadFromUsbFn,
} from './sysinfo-extended.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Realistic SysInfoExtended XML based on iPod Nano 3G data */
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>FireWireGUID</key>
	<string>000A27001DCECFB5</string>
	<key>SerialNumber</key>
	<string>5U828GFNYXX</string>
	<key>FamilyID</key>
	<integer>10</integer>
	<key>DBVersion</key>
	<integer>3</integer>
	<key>ModelNumber</key>
	<string>B261</string>
	<key>UpdaterFamilyID</key>
	<integer>10</integer>
	<key>BoardHwSwInterfaceRev</key>
	<integer>65536</integer>
	<key>VisibleBuildID</key>
	<string>1.1.3 (3.1.1)</string>
</dict>
</plist>`;

/** XML missing FireWireGUID */
const FIXTURE_XML_NO_GUID = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>SerialNumber</key>
	<string>5U828GFNYXX</string>
</dict>
</plist>`;

/** XML missing SerialNumber */
const FIXTURE_XML_NO_SERIAL = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>FireWireGUID</key>
	<string>000A27001DCECFB5</string>
</dict>
</plist>`;

/** XML with alternate FirewireGuid casing */
const FIXTURE_XML_ALT_CASING = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>FirewireGuid</key>
	<string>000A27001DCECFB5</string>
	<key>SerialNumber</key>
	<string>5U828GFNYXX</string>
</dict>
</plist>`;

// ── Test helpers ────────────────────────────────────────────────────────────

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-sysinfo-ext-'));
}

function createIpodStructure(mountPoint: string): void {
  fs.mkdirSync(path.join(mountPoint, 'iPod_Control', 'Device'), {
    recursive: true,
  });
}

function writeSysInfoExtended(mountPoint: string, content: string): void {
  const deviceDir = path.join(mountPoint, 'iPod_Control', 'Device');
  fs.mkdirSync(deviceDir, { recursive: true });
  fs.writeFileSync(path.join(deviceDir, 'SysInfoExtended'), content, 'utf-8');
}

const USB_ADDRESS = { busNumber: 1, deviceAddress: 4 };

// ── readSysInfoExtended ─────────────────────────────────────────────────────

describe('readSysInfoExtended', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses existing SysInfoExtended and extracts device info', () => {
    writeSysInfoExtended(tmpDir, FIXTURE_XML);
    const result = readSysInfoExtended(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.present).toBe(true);
    expect(result!.source).toBe('existing');
    expect(result!.deviceInfo).toBeDefined();
    expect(result!.deviceInfo!.firewireGuid).toBe('000A27001DCECFB5');
    expect(result!.deviceInfo!.serialNumber).toBe('5U828GFNYXX');
  });

  it('returns null when file does not exist', () => {
    createIpodStructure(tmpDir);
    const result = readSysInfoExtended(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null when file is empty', () => {
    writeSysInfoExtended(tmpDir, '');
    const result = readSysInfoExtended(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null when file is whitespace-only', () => {
    writeSysInfoExtended(tmpDir, '   \n  \n  ');
    const result = readSysInfoExtended(tmpDir);
    expect(result).toBeNull();
  });

  it('returns result with no deviceInfo when XML lacks required keys', () => {
    writeSysInfoExtended(tmpDir, FIXTURE_XML_NO_GUID);
    const result = readSysInfoExtended(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.present).toBe(true);
    expect(result!.source).toBe('existing');
    // deviceInfo is undefined because FireWireGUID is missing
    expect(result!.deviceInfo).toBeUndefined();
  });

  it('handles alternate FirewireGuid casing', () => {
    writeSysInfoExtended(tmpDir, FIXTURE_XML_ALT_CASING);
    const result = readSysInfoExtended(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.deviceInfo).toBeDefined();
    expect(result!.deviceInfo!.firewireGuid).toBe('000A27001DCECFB5');
  });

  it('looks up model from serial suffix', () => {
    writeSysInfoExtended(tmpDir, FIXTURE_XML);
    const result = readSysInfoExtended(tmpDir);

    expect(result!.deviceInfo!.modelName).toBeDefined();
    // Serial "5U828GFNYXX" -> suffix "YXX" -> iPod nano 3rd Gen
    expect(result!.deviceInfo!.modelName).toContain('nano');
    expect(result!.deviceInfo!.modelName).toContain('3rd Generation');
    expect(result!.deviceInfo!.generationId).toBe('nano_3g');
    expect(result!.deviceInfo!.checksumType).toBeDefined();
  });

  it('returns deviceInfo without model fields for unknown serial suffix', () => {
    const xml = FIXTURE_XML.replace('5U828GFNYXX', 'UNKNOWNZZZ');
    writeSysInfoExtended(tmpDir, xml);

    const result = readSysInfoExtended(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.deviceInfo).toBeDefined();
    expect(result!.deviceInfo!.firewireGuid).toBe('000A27001DCECFB5');
    expect(result!.deviceInfo!.serialNumber).toBe('UNKNOWNZZZ');
    expect(result!.deviceInfo!.modelName).toBeUndefined();
    expect(result!.deviceInfo!.generationId).toBeUndefined();
    expect(result!.deviceInfo!.checksumType).toBeUndefined();
  });
});

// ── ensureSysInfoExtended ───────────────────────────────────────────────────

describe('ensureSysInfoExtended', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns existing file without calling USB read', async () => {
    writeSysInfoExtended(tmpDir, FIXTURE_XML);

    let usbReadCalled = false;
    const mockReader: ReadFromUsbFn = () => {
      usbReadCalled = true;
      return FIXTURE_XML;
    };

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, mockReader);

    expect(result.present).toBe(true);
    expect(result.source).toBe('existing');
    expect(result.deviceInfo!.firewireGuid).toBe('000A27001DCECFB5');
    expect(usbReadCalled).toBe(false);
  });

  it('reads from USB and writes to disk when file is missing', async () => {
    createIpodStructure(tmpDir);
    const mockReader: ReadFromUsbFn = () => FIXTURE_XML;

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, mockReader);

    expect(result.present).toBe(true);
    expect(result.source).toBe('usb-read');
    expect(result.deviceInfo!.firewireGuid).toBe('000A27001DCECFB5');
    expect(result.deviceInfo!.serialNumber).toBe('5U828GFNYXX');

    // Verify file was written
    const filePath = path.join(tmpDir, 'iPod_Control', 'Device', 'SysInfoExtended');
    expect(fs.existsSync(filePath)).toBe(true);
    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toBe(FIXTURE_XML);
  });

  it('returns unavailable when USB read returns null', async () => {
    createIpodStructure(tmpDir);
    const mockReader: ReadFromUsbFn = () => null;

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, mockReader);

    expect(result.present).toBe(false);
    expect(result.source).toBe('unavailable');
    expect(result.error).toBe('Could not read device identity from USB');
  });

  it('returns unavailable when no reader is provided and native is unavailable', async () => {
    createIpodStructure(tmpDir);

    // Pass no readFromUsb — the default resolver will fail in test env
    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS);

    expect(result.present).toBe(false);
    expect(result.source).toBe('unavailable');
    expect(result.error).toContain('not available');
  });

  it('validates XML and rejects missing FireWireGUID', async () => {
    createIpodStructure(tmpDir);
    const mockReader: ReadFromUsbFn = () => FIXTURE_XML_NO_GUID;

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, mockReader);

    expect(result.present).toBe(false);
    expect(result.source).toBe('unavailable');
    expect(result.error).toBe('Device returned incomplete identity data');

    // Verify file was NOT written
    const filePath = path.join(tmpDir, 'iPod_Control', 'Device', 'SysInfoExtended');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('validates XML and rejects missing SerialNumber', async () => {
    createIpodStructure(tmpDir);
    const mockReader: ReadFromUsbFn = () => FIXTURE_XML_NO_SERIAL;

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, mockReader);

    expect(result.present).toBe(false);
    expect(result.source).toBe('unavailable');
    expect(result.error).toBe('Device returned incomplete identity data');
  });

  it('creates Device directory when it does not exist', async () => {
    // Only create iPod_Control, not Device subdirectory
    fs.mkdirSync(path.join(tmpDir, 'iPod_Control'), { recursive: true });

    const deviceDir = path.join(tmpDir, 'iPod_Control', 'Device');
    expect(fs.existsSync(deviceDir)).toBe(false);

    const mockReader: ReadFromUsbFn = () => FIXTURE_XML;
    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, mockReader);

    expect(result.present).toBe(true);
    expect(result.source).toBe('usb-read');
    expect(fs.existsSync(deviceDir)).toBe(true);

    const filePath = path.join(deviceDir, 'SysInfoExtended');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('extracts model info from serial suffix', async () => {
    createIpodStructure(tmpDir);
    const mockReader: ReadFromUsbFn = () => FIXTURE_XML;

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, mockReader);

    expect(result.deviceInfo).toBeDefined();
    // Serial "5U828GFNYXX" -> suffix "YXX" -> nano 3G
    expect(result.deviceInfo!.modelName).toContain('nano');
    expect(result.deviceInfo!.modelName).toContain('3rd Generation');
    expect(result.deviceInfo!.generationId).toBe('nano_3g');
    expect(result.deviceInfo!.checksumType).toBeDefined();
  });

  it('handles alternate FirewireGuid casing in USB-read XML', async () => {
    createIpodStructure(tmpDir);
    const mockReader: ReadFromUsbFn = () => FIXTURE_XML_ALT_CASING;

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, mockReader);

    expect(result.present).toBe(true);
    expect(result.source).toBe('usb-read');
    expect(result.deviceInfo!.firewireGuid).toBe('000A27001DCECFB5');
  });
});
