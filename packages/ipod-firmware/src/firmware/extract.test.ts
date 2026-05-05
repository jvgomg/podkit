/**
 * Tests for extractFromPlist and bigintToFireWireGuid.
 *
 * Each fixture test loads a real SysInfoExtended XML capture, runs parsePlist
 * then extractFromPlist, and asserts the values match the known hardware
 * inventory in documents/test-devices.md.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePlist } from '../plist/parser.js';
import { extractFromPlist, bigintToFireWireGuid } from './extract.js';

// Resolve fixture paths relative to project root (not this file's location)
const FIXTURES = resolve(import.meta.dir, '../../../..', 'documents/sysinfo-captures');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8');
}

// =============================================================================
// bigintToFireWireGuid helper
// =============================================================================

describe('bigintToFireWireGuid', () => {
  it('formats a small GUID with leading zeros', () => {
    expect(bigintToFireWireGuid(0n)).toBe('0000000000000000');
  });

  it('formats a known GUID correctly (nano 4G)', () => {
    // 0x000A27001DCECFB5 = nano 4G FireWire GUID
    expect(bigintToFireWireGuid(0x000a27001dcecfb5n)).toBe('000A27001DCECFB5');
  });

  it('pads short values to exactly 16 chars', () => {
    expect(bigintToFireWireGuid(0xdeadbeefn)).toBe('00000000DEADBEEF');
  });

  it('formats a full 64-bit value (no 0x prefix, uppercase)', () => {
    expect(bigintToFireWireGuid(0xffffffffffffffffn)).toBe('FFFFFFFFFFFFFFFF');
  });
});

// =============================================================================
// Null cases
// =============================================================================

describe('extractFromPlist — null cases', () => {
  it('returns null when FireWireGUID is missing', () => {
    const xml = `<?xml version="1.0"?>
<plist version="1.0">
<dict>
<key>SerialNumber</key><string>ABC123</string>
<key>FamilyID</key><integer>9</integer>
</dict>
</plist>`;
    const plist = parsePlist(xml);
    expect(extractFromPlist(plist, xml)).toBeNull();
  });

  it('returns null when SerialNumber is missing', () => {
    const xml = `<?xml version="1.0"?>
<plist version="1.0">
<dict>
<key>FireWireGUID</key><string>000A27001A0647CB</string>
<key>FamilyID</key><integer>9</integer>
</dict>
</plist>`;
    const plist = parsePlist(xml);
    expect(extractFromPlist(plist, xml)).toBeNull();
  });

  it('returns null when FamilyID is missing', () => {
    const xml = `<?xml version="1.0"?>
<plist version="1.0">
<dict>
<key>FireWireGUID</key><string>000A27001A0647CB</string>
<key>SerialNumber</key><string>YM7275YSVQH</string>
</dict>
</plist>`;
    const plist = parsePlist(xml);
    expect(extractFromPlist(plist, xml)).toBeNull();
  });

  it('returns null when the root plist element is not a dict', () => {
    const xml = `<?xml version="1.0"?><plist version="1.0"><string>nope</string></plist>`;
    const plist = parsePlist(xml);
    expect(extractFromPlist(plist, xml)).toBeNull();
  });
});

// =============================================================================
// Round-trip: rawXml is preserved
// =============================================================================

describe('extractFromPlist — rawXml round-trip', () => {
  it('returns the exact rawXml string passed in', () => {
    const xml = loadFixture('nano-2g-4gb-green.xml');
    const plist = parsePlist(xml);
    const result = extractFromPlist(plist, xml);
    expect(result).not.toBeNull();
    expect(result!.rawXml).toBe(xml);
  });
});

// =============================================================================
// Fixture: iPod nano 2G (4GB Green)
// FamilyID: 9, GUID: 000A27001A0647CB, Serial: YM7275YSVQH, FW: 1.1.3
// Audio: MP3, AIFF, WAV, AAC, AppleLossless, Audible — no video
// Artwork: 176x132 (1023), 41x37 (1032); AlbumArt: 42x42 (1031), 100x100 (1027)
// RAM: 32 MB
// =============================================================================

describe('fixture: nano-2g-4gb-green', () => {
  const xml = loadFixture('nano-2g-4gb-green.xml');
  const plist = parsePlist(xml);
  const result = extractFromPlist(plist, xml);

  it('parses successfully', () => {
    expect(result).not.toBeNull();
  });

  it('identity: FireWire GUID', () => {
    expect(result!.firewireGuid).toBe('000A27001A0647CB');
  });

  it('identity: serial number', () => {
    expect(result!.serialNumber).toBe('YM7275YSVQH');
  });

  it('capabilities: FamilyID = 9', () => {
    expect(result!.capabilities?.familyId).toBe(9);
  });

  it('capabilities: firmware version = 1.1.3', () => {
    expect(result!.capabilities?.firmwareVersion).toBe('1.1.3');
  });

  it('capabilities: RAM = 32 MB in bytes', () => {
    expect(result!.capabilities?.ramBytes).toBe(32 * 1024 * 1024);
  });

  it('capabilities: audio codecs include MP3, AAC, AIFF, WAV, AppleLossless', () => {
    const codecs = result!.capabilities?.audioCodecs.map((c) => c.codec) ?? [];
    expect(codecs).toContain('MP3');
    expect(codecs).toContain('AAC');
    expect(codecs).toContain('AIFF');
    expect(codecs).toContain('WAV');
    expect(codecs).toContain('AppleLossless');
  });

  it('capabilities: no video codecs', () => {
    expect(result!.capabilities?.videoCodecs).toBeUndefined();
  });

  it('capabilities: artwork formats present (FormatId 1023 = 176x132)', () => {
    const formats = result!.capabilities?.artworkFormats ?? [];
    expect(formats.length).toBeGreaterThan(0);
    const f1023 = formats.find((f) => f.formatId === 1023);
    expect(f1023).toBeDefined();
    expect(f1023!.width).toBe(176);
    expect(f1023!.height).toBe(132);
  });

  it('capabilities: album art formats present (FormatId 1027 = 100x100)', () => {
    const formats = result!.capabilities?.albumArtFormats ?? [];
    expect(formats.length).toBeGreaterThan(0);
    const f1027 = formats.find((f) => f.formatId === 1027);
    expect(f1027).toBeDefined();
    expect(f1027!.width).toBe(100);
    expect(f1027!.height).toBe(100);
  });
});

// =============================================================================
// Fixture: iPod nano 4G (8GB Black)
// FamilyID: 15, GUID: 000A27001DCECFB5, Serial: 5U851AEH3R0, FW: 1.0.4
// Audio: MP3, AIFF, WAV, AAC, AppleLossless, Audible
// Video: H.264, MPEG4, H.264LC
// Artwork: 320x240 (1024), 240x320 (1083), 640x480 JPEG (1081), 80x80 (1079), 64x64 (1066)
// AlbumArt: 128x128 (1055), 128x128 (1068), 80x80 (1078), 240x240 (1071), 240x240 (1084), 50x50 (1074)
// DBVersion: 3, RAM: 32 MB
// =============================================================================

describe('fixture: nano-4g-8gb-black', () => {
  const xml = loadFixture('nano-4g-8gb-black.xml');
  const plist = parsePlist(xml);
  const result = extractFromPlist(plist, xml);

  it('parses successfully', () => {
    expect(result).not.toBeNull();
  });

  it('identity: FireWire GUID', () => {
    expect(result!.firewireGuid).toBe('000A27001DCECFB5');
  });

  it('identity: serial number', () => {
    expect(result!.serialNumber).toBe('5U851AEH3R0');
  });

  it('capabilities: FamilyID = 15', () => {
    expect(result!.capabilities?.familyId).toBe(15);
  });

  it('capabilities: firmware version = 1.0.4', () => {
    expect(result!.capabilities?.firmwareVersion).toBe('1.0.4');
  });

  it('capabilities: DBVersion = 3', () => {
    expect(result!.capabilities?.dbVersion).toBe(3);
  });

  it('capabilities: RAM = 32 MB in bytes', () => {
    expect(result!.capabilities?.ramBytes).toBe(32 * 1024 * 1024);
  });

  it('capabilities: audio codecs include expected set', () => {
    const codecs = result!.capabilities?.audioCodecs.map((c) => c.codec) ?? [];
    expect(codecs).toContain('MP3');
    expect(codecs).toContain('AAC');
    expect(codecs).toContain('AIFF');
    expect(codecs).toContain('WAV');
    expect(codecs).toContain('AppleLossless');
  });

  it('capabilities: video codecs present (H.264, MPEG4, H.264LC)', () => {
    const codecs = result!.capabilities?.videoCodecs?.map((c) => c.codec) ?? [];
    expect(codecs).toContain('H.264');
    expect(codecs).toContain('MPEG4');
    expect(codecs).toContain('H.264LC');
  });

  it('capabilities: H.264LC has profile B and level 30', () => {
    const h264lc = result!.capabilities?.videoCodecs?.find((c) => c.codec === 'H.264LC');
    expect(h264lc).toBeDefined();
    expect(h264lc!.profile).toBe('B');
    expect(h264lc!.level).toBe('30');
  });

  it('capabilities: H.264LC max resolution 640x480', () => {
    const h264lc = result!.capabilities?.videoCodecs?.find((c) => c.codec === 'H.264LC');
    expect(h264lc!.maxResolution).toBe('640x480');
  });

  it('capabilities: artwork formats present (320x240, format 1024)', () => {
    const f1024 = result!.capabilities?.artworkFormats?.find((f) => f.formatId === 1024);
    expect(f1024).toBeDefined();
    expect(f1024!.width).toBe(320);
    expect(f1024!.height).toBe(240);
  });

  it('capabilities: album art formats present (128x128, format 1055)', () => {
    const f1055 = result!.capabilities?.albumArtFormats?.find((f) => f.formatId === 1055);
    expect(f1055).toBeDefined();
    expect(f1055!.width).toBe(128);
    expect(f1055!.height).toBe(128);
  });

  it('capabilities: pixel format decoded (L565)', () => {
    const f1024 = result!.capabilities?.artworkFormats?.find((f) => f.formatId === 1024);
    expect(f1024?.pixelFormat).toBe('L565');
  });
});

// =============================================================================
// Fixture: iPod mini 2G
// FamilyID: 3, GUID: 000A270014198517, Serial: JQ5141TFS4G, FW: 1.3 (BuildID 2.5)
// Audio: MP3, AIFF, WAV, AAC, AppleLossless, Audible — no video, no artwork arrays
// No RAM key, no DBVersion
// =============================================================================

describe('fixture: mini-2g', () => {
  const xml = loadFixture('mini-2g.xml');
  const plist = parsePlist(xml);
  const result = extractFromPlist(plist, xml);

  it('parses successfully', () => {
    expect(result).not.toBeNull();
  });

  it('identity: FireWire GUID', () => {
    expect(result!.firewireGuid).toBe('000A270014198517');
  });

  it('identity: serial number', () => {
    expect(result!.serialNumber).toBe('JQ5141TFS4G');
  });

  it('capabilities: FamilyID = 3', () => {
    expect(result!.capabilities?.familyId).toBe(3);
  });

  it('capabilities: firmware version = 1.3', () => {
    // mini-2g uses VisibleBuildID "1.3"
    expect(result!.capabilities?.firmwareVersion).toBe('1.3');
  });

  it('capabilities: no DBVersion', () => {
    expect(result!.capabilities?.dbVersion).toBeUndefined();
  });

  it('capabilities: no RAM key → ramBytes undefined', () => {
    expect(result!.capabilities?.ramBytes).toBeUndefined();
  });

  it('capabilities: audio codecs present', () => {
    const codecs = result!.capabilities?.audioCodecs.map((c) => c.codec) ?? [];
    expect(codecs).toContain('MP3');
    expect(codecs).toContain('AAC');
  });

  it('capabilities: no video codecs', () => {
    expect(result!.capabilities?.videoCodecs).toBeUndefined();
  });

  it('capabilities: no artwork formats (mini 2G has none)', () => {
    // mini-2g.xml has no ImageSpecifications or AlbumArt arrays
    expect(result!.capabilities?.artworkFormats).toBeUndefined();
    expect(result!.capabilities?.albumArtFormats).toBeUndefined();
  });
});

// =============================================================================
// Fixture: iPod 5G Video iFlash 1TB
// FamilyID: 6, GUID: 000A27001605D1A0, Serial: 9C642MEFV9M, FW: 1.3 (BuildID 6.3)
// Audio: MP3, AIFF, WAV, AAC, AppleLossless, Audible
// Video: H.264, H.264LC, MPEG4
// AlbumArt: 100x100 (1028), 200x200 (1029)
// RAM: 32 MB — no DBVersion
// =============================================================================

describe('fixture: ipod-5g-video-iflash-1tb', () => {
  const xml = loadFixture('ipod-5g-video-iflash-1tb.xml');
  const plist = parsePlist(xml);
  const result = extractFromPlist(plist, xml);

  it('parses successfully', () => {
    expect(result).not.toBeNull();
  });

  it('identity: FireWire GUID', () => {
    expect(result!.firewireGuid).toBe('000A27001605D1A0');
  });

  it('identity: serial number', () => {
    expect(result!.serialNumber).toBe('9C642MEFV9M');
  });

  it('capabilities: FamilyID = 6', () => {
    expect(result!.capabilities?.familyId).toBe(6);
  });

  it('capabilities: firmware version = 1.3', () => {
    expect(result!.capabilities?.firmwareVersion).toBe('1.3');
  });

  it('capabilities: RAM = 32 MB in bytes', () => {
    expect(result!.capabilities?.ramBytes).toBe(32 * 1024 * 1024);
  });

  it('capabilities: audio codecs include expected set', () => {
    const codecs = result!.capabilities?.audioCodecs.map((c) => c.codec) ?? [];
    expect(codecs).toContain('MP3');
    expect(codecs).toContain('AAC');
    expect(codecs).toContain('AppleLossless');
  });

  it('capabilities: video codecs present', () => {
    const codecs = result!.capabilities?.videoCodecs?.map((c) => c.codec) ?? [];
    expect(codecs).toContain('H.264');
    expect(codecs).toContain('MPEG4');
    expect(codecs).toContain('H.264LC');
  });

  it('capabilities: H.264 max resolution 4800x4800 (iPod 5G quirk)', () => {
    const h264 = result!.capabilities?.videoCodecs?.find((c) => c.codec === 'H.264');
    expect(h264!.maxResolution).toBe('4800x4800');
  });

  it('capabilities: H.264LC has profile B', () => {
    const h264lc = result!.capabilities?.videoCodecs?.find((c) => c.codec === 'H.264LC');
    expect(h264lc?.profile).toBe('B');
  });

  it('capabilities: album art formats present (100x100, 200x200)', () => {
    const formats = result!.capabilities?.albumArtFormats ?? [];
    const f1028 = formats.find((f) => f.formatId === 1028);
    expect(f1028).toBeDefined();
    expect(f1028!.width).toBe(100);
    expect(f1028!.height).toBe(100);
    const f1029 = formats.find((f) => f.formatId === 1029);
    expect(f1029!.width).toBe(200);
    expect(f1029!.height).toBe(200);
  });
});

// =============================================================================
// Fixture: iPod nano 7G — SCSI capture (minimal data)
// FamilyID: 18, GUID: 000A270024A23E9E, Serial: DCYN72R8FJQ1, FW: 1.0.4
// SCSI capture has no AudioCodecs, no VideoCodecs, no artwork arrays
// DBVersion: 5, RAM: 64 MB
// =============================================================================

describe('fixture: nano-7g-16gb-scsi', () => {
  const xml = loadFixture('nano-7g-16gb-scsi.xml');
  const plist = parsePlist(xml);
  const result = extractFromPlist(plist, xml);

  it('parses successfully', () => {
    expect(result).not.toBeNull();
  });

  it('identity: FireWire GUID', () => {
    expect(result!.firewireGuid).toBe('000A270024A23E9E');
  });

  it('identity: serial number', () => {
    expect(result!.serialNumber).toBe('DCYN72R8FJQ1');
  });

  it('capabilities: FamilyID = 18', () => {
    expect(result!.capabilities?.familyId).toBe(18);
  });

  it('capabilities: firmware version = 1.0.4', () => {
    expect(result!.capabilities?.firmwareVersion).toBe('1.0.4');
  });

  it('capabilities: DBVersion = 5', () => {
    expect(result!.capabilities?.dbVersion).toBe(5);
  });

  it('capabilities: RAM = 64 MB in bytes', () => {
    expect(result!.capabilities?.ramBytes).toBe(64 * 1024 * 1024);
  });

  it('capabilities: no audio codecs in SCSI capture', () => {
    // SCSI capture for nano 7G has no AudioCodecs key
    expect(result!.capabilities?.audioCodecs).toEqual([]);
  });

  it('capabilities: no video codecs in SCSI capture', () => {
    expect(result!.capabilities?.videoCodecs).toBeUndefined();
  });

  it('capabilities: no artwork in SCSI capture', () => {
    expect(result!.capabilities?.artworkFormats).toBeUndefined();
    expect(result!.capabilities?.albumArtFormats).toBeUndefined();
  });
});

// =============================================================================
// Fixture: iPod nano 7G — USB capture (full data)
// Same identity as SCSI capture; USB has AudioCodecs, VideoCodecs, artwork
// Uses ImageSpecifications2 / AlbumArt2 (primary arrays are empty)
// =============================================================================

describe('fixture: nano-7g-16gb-usb', () => {
  const xml = loadFixture('nano-7g-16gb-usb.xml');
  const plist = parsePlist(xml);
  const result = extractFromPlist(plist, xml);

  it('parses successfully', () => {
    expect(result).not.toBeNull();
  });

  it('identity matches SCSI capture (same device)', () => {
    expect(result!.firewireGuid).toBe('000A270024A23E9E');
    expect(result!.serialNumber).toBe('DCYN72R8FJQ1');
  });

  it('capabilities: FamilyID = 18', () => {
    expect(result!.capabilities?.familyId).toBe(18);
  });

  it('capabilities: audio codecs present in USB capture', () => {
    const codecs = result!.capabilities?.audioCodecs.map((c) => c.codec) ?? [];
    expect(codecs).toContain('MP3');
    expect(codecs).toContain('AAC');
    expect(codecs).toContain('AppleLossless');
  });

  it('capabilities: video codecs present in USB capture', () => {
    const codecs = result!.capabilities?.videoCodecs?.map((c) => c.codec) ?? [];
    expect(codecs).toContain('H.264');
    expect(codecs).toContain('MPEG4');
    expect(codecs).toContain('H.264LC');
  });

  it('capabilities: artwork from ImageSpecifications2 (primary is empty)', () => {
    const formats = result!.capabilities?.artworkFormats ?? [];
    expect(formats.length).toBeGreaterThan(0);
    // FormatId 1007 = 480x864 (portrait display)
    const f1007 = formats.find((f) => f.formatId === 1007);
    expect(f1007).toBeDefined();
    expect(f1007!.width).toBe(480);
    expect(f1007!.height).toBe(864);
  });

  it('capabilities: album art from AlbumArt2 (primary is empty)', () => {
    const formats = result!.capabilities?.albumArtFormats ?? [];
    expect(formats.length).toBeGreaterThan(0);
    // FormatId 1010 = 240x240
    const f1010 = formats.find((f) => f.formatId === 1010);
    expect(f1010).toBeDefined();
    expect(f1010!.width).toBe(240);
    expect(f1010!.height).toBe(240);
  });
});
