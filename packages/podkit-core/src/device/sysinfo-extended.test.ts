import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ensureSysInfoExtended,
  readSysInfoExtended,
  type ReadFromUsbFn,
} from '@podkit/ipod-firmware';
import { identify } from '@podkit/devices-ipod';

/** Inject the model resolver so result.model is populated from serial suffix. */
const resolveModel = (sn: string) => identify({ from: 'serial', serialNumber: sn }) ?? undefined;

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

const USB_ADDRESS = {
  vendorId: '05ac',
  productId: '1261',
  serialNumber: '000A27001DCECFB5',
  bus: 1,
  devnum: 4,
};

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
    const result = readSysInfoExtended(tmpDir, resolveModel);

    expect(result).not.toBeNull();
    expect(result!.present).toBe(true);
    expect(result!.source).toBe('existing');
    expect(result!.firewireGuid).toBe('000A27001DCECFB5');
    expect(result!.serialNumber).toBe('5U828GFNYXX');
    expect(result!.model).toBeDefined();
  });

  it('returns null when file does not exist', () => {
    createIpodStructure(tmpDir);
    const result = readSysInfoExtended(tmpDir, resolveModel);
    expect(result).toBeNull();
  });

  it('returns null when file is empty', () => {
    writeSysInfoExtended(tmpDir, '');
    const result = readSysInfoExtended(tmpDir, resolveModel);
    expect(result).toBeNull();
  });

  it('returns null when file is whitespace-only', () => {
    writeSysInfoExtended(tmpDir, '   \n  \n  ');
    const result = readSysInfoExtended(tmpDir, resolveModel);
    expect(result).toBeNull();
  });

  it('returns result with no model when XML lacks required keys', () => {
    writeSysInfoExtended(tmpDir, FIXTURE_XML_NO_GUID);
    const result = readSysInfoExtended(tmpDir, resolveModel);

    expect(result).not.toBeNull();
    expect(result!.present).toBe(true);
    expect(result!.source).toBe('existing');
    // model is undefined because FireWireGUID is missing (identity extraction fails)
    expect(result!.model).toBeUndefined();
  });

  it('handles alternate FirewireGuid casing', () => {
    writeSysInfoExtended(tmpDir, FIXTURE_XML_ALT_CASING);
    const result = readSysInfoExtended(tmpDir, resolveModel);

    expect(result).not.toBeNull();
    expect(result!.firewireGuid).toBe('000A27001DCECFB5');
  });

  it('looks up model from serial suffix', () => {
    writeSysInfoExtended(tmpDir, FIXTURE_XML);
    const result = readSysInfoExtended(tmpDir, resolveModel);

    expect(result!.model).toBeDefined();
    // Serial "5U828GFNYXX" -> suffix "YXX" -> iPod nano 3rd Gen
    expect(result!.model!.displayName).toContain('nano');
    expect(result!.model!.displayName).toContain('3rd Generation');
    expect(result!.model!.generationId).toBe('nano_3g');
    expect(result!.model!.checksumType).toBeDefined();
    expect(result!.model!.source).toBe('serial');
  });

  it('returns identity without model for unknown serial suffix', () => {
    const xml = FIXTURE_XML.replace('5U828GFNYXX', 'UNKNOWNZZZ');
    writeSysInfoExtended(tmpDir, xml);

    const result = readSysInfoExtended(tmpDir, resolveModel);

    expect(result).not.toBeNull();
    expect(result!.firewireGuid).toBe('000A27001DCECFB5');
    expect(result!.serialNumber).toBe('UNKNOWNZZZ');
    expect(result!.model).toBeUndefined();
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

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, { readFromUsb: mockReader });

    expect(result.present).toBe(true);
    expect(result.source).toBe('existing');
    expect(result.firewireGuid).toBe('000A27001DCECFB5');
    expect(usbReadCalled).toBe(false);
  });

  it('reads from USB and writes to disk when file is missing', async () => {
    createIpodStructure(tmpDir);
    const mockReader: ReadFromUsbFn = () => FIXTURE_XML;

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, { readFromUsb: mockReader });

    expect(result.present).toBe(true);
    expect(result.source).toBe('usb-read');
    expect(result.firewireGuid).toBe('000A27001DCECFB5');
    expect(result.serialNumber).toBe('5U828GFNYXX');

    // Verify file was written
    const filePath = path.join(tmpDir, 'iPod_Control', 'Device', 'SysInfoExtended');
    expect(fs.existsSync(filePath)).toBe(true);
    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toBe(FIXTURE_XML);
  });

  it('returns unavailable when USB read returns null', async () => {
    createIpodStructure(tmpDir);
    const mockReader: ReadFromUsbFn = () => null;

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, { readFromUsb: mockReader });

    expect(result.present).toBe(false);
    expect(result.source).toBe('unavailable');
    expect(result.error).toBe('Could not read device identity from USB');
  });

  it('surfaces error message when USB read throws', async () => {
    createIpodStructure(tmpDir);
    const mockReader: ReadFromUsbFn = () => {
      throw new Error(
        'USB control transfer failed (bus 1, device 4) — device may not support SysInfoExtended over USB, or insufficient USB permissions'
      );
    };

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, { readFromUsb: mockReader });

    expect(result.present).toBe(false);
    expect(result.source).toBe('unavailable');
    expect(result.error).toContain('USB control transfer failed');
    expect(result.error).toContain('bus 1, device 4');
  });

  it('returns unavailable when reader returns null (no XML payload)', async () => {
    createIpodStructure(tmpDir);

    // Mock reader returns null — deterministic across machines. Previously
    // this test omitted the reader and relied on the production path
    // returning null for invalid bus/devnum. That assumption broke once
    // ensureSysInfoExtended started routing through @podkit/ipod-firmware's
    // orchestrator, which on a dev machine with a real iPod attached can
    // succeed via SCSI fallback regardless of the bus/devnum requested
    // (macOS SCSI matches by IOService class, not bus/devnum). Injecting
    // a null-returning reader exercises the same "unavailable" code path
    // independent of host hardware.
    const mockReader: ReadFromUsbFn = () => null;
    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, { readFromUsb: mockReader });

    expect(result.present).toBe(false);
    expect(result.source).toBe('unavailable');
  });

  it('validates XML and rejects missing FireWireGUID', async () => {
    createIpodStructure(tmpDir);
    const mockReader: ReadFromUsbFn = () => FIXTURE_XML_NO_GUID;

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, { readFromUsb: mockReader });

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

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, { readFromUsb: mockReader });

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
    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, { readFromUsb: mockReader });

    expect(result.present).toBe(true);
    expect(result.source).toBe('usb-read');
    expect(fs.existsSync(deviceDir)).toBe(true);

    const filePath = path.join(deviceDir, 'SysInfoExtended');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('extracts model info from serial suffix', async () => {
    createIpodStructure(tmpDir);
    const mockReader: ReadFromUsbFn = () => FIXTURE_XML;

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, {
      readFromUsb: mockReader,
      resolveModel,
    });

    expect(result.model).toBeDefined();
    // Serial "5U828GFNYXX" -> suffix "YXX" -> nano 3G
    expect(result.model!.displayName).toContain('nano');
    expect(result.model!.displayName).toContain('3rd Generation');
    expect(result.model!.generationId).toBe('nano_3g');
    expect(result.model!.checksumType).toBeDefined();
    expect(result.model!.source).toBe('serial');
  });

  it('handles alternate FirewireGuid casing in USB-read XML', async () => {
    createIpodStructure(tmpDir);
    const mockReader: ReadFromUsbFn = () => FIXTURE_XML_ALT_CASING;

    const result = await ensureSysInfoExtended(tmpDir, USB_ADDRESS, { readFromUsb: mockReader });

    expect(result.present).toBe(true);
    expect(result.source).toBe('usb-read');
    expect(result.firewireGuid).toBe('000A27001DCECFB5');
  });
});
