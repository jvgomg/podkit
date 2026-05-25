/**
 * unit smoke tests for the `malformed-sysinfo` persona + expectations.
 *
 * Separate from `rejection-personas.test.ts` because this is not strictly
 * a rejection persona — the USB classifier accepts the device as a
 * supported iPod 5G Video; the SIE parser is the layer that fails.
 *
 * Pins the synthesis recipe (real iPod identity + deliberately-truncated
 * SIE XML) so future schema changes can't accidentally drop the fixture
 * out of "parser fails cleanly" shape.
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { parsePlist } from '@podkit/ipod-firmware';
import { malformedSysinfo, personas } from '@podkit/device-testing';
import * as expectations from './malformed-sysinfo.js';

describe('malformed-sysinfo persona (synthesised)', () => {
  it('is registered in the persona registry under its declared id', () => {
    expect(personas.get('malformed-sysinfo')).toBe(malformedSysinfo);
  });

  it('mirrors a real supported iPod 5G Video USB identity', () => {
    // Same PID as `ipod-video-5g-iflash-1tb` — the classifier accepts it.
    expect(malformedSysinfo.usbDescriptor.vendorId).toBe(0x05ac);
    expect(malformedSysinfo.usbDescriptor.productId).toBe(0x1209);
    expect(malformedSysinfo.usbDescriptor.deviceSerial?.length ?? 0).toBeGreaterThan(0);
  });

  it('ships a truncated SIE XML payload (exactly 500 bytes)', () => {
    // Synthesis recipe documented in `provenance.md` § "Corruption strategy"
    // — `head -c 500` of the iPod 5G Video SIE XML.
    expect(typeof malformedSysinfo.sysInfoExtendedXml).toBe('string');
    expect(malformedSysinfo.sysInfoExtendedXml).not.toBeNull();
    expect(malformedSysinfo.sysInfoExtendedXml!.length).toBe(500);
  });

  it('XML is not structurally well-formed (cut mid-element, no closing plist)', () => {
    // Sanity check that no surprise edit has un-corrupted the fixture.
    // The 500-byte cut lands inside `<key>MaximumSampleRate<…`; the
    // payload has no `</plist>` closing tag and ends mid-element.
    const xml = malformedSysinfo.sysInfoExtendedXml!;
    expect(xml).not.toContain('</plist>');
    // Last byte must be `<` (mid-tag) — confirms the cut is structural,
    // not coincidentally on an element boundary.
    expect(xml.endsWith('<')).toBe(true);
  });

  it('parsePlist throws when given the truncated XML — the path under test', () => {
    // The whole point of this persona: `parsePlist` must fail. If a
    // future parser becomes lenient enough to accept truncated input,
    // the persona needs a more aggressive corruption — see
    // `provenance.md` for the other strategies considered.
    const xml = malformedSysinfo.sysInfoExtendedXml!;
    expect(() => parsePlist(xml)).toThrow();
  });

  it('expectedReadiness.level === needs-repair (matches the determineLevel cascade)', () => {
    // `determineLevel`'s "SysInfo check failed" rule
    // (`packages/podkit-core/src/device/readiness/determine-level.ts:88`)
    // resolves a fail `sysinfo` stage to `needs-repair`.
    expect(expectations.expectedReadiness.level).toBe('needs-repair');
  });

  it('expectedReadiness has a single failed sysinfo stage', () => {
    const stages = expectations.expectedReadiness.stages;
    expect(stages).toHaveLength(1);
    expect(stages[0]?.stage).toBe('sysinfo');
    expect(stages[0]?.status).toBe('fail');
    // The exact wording is checked loosely — only the `parsePlist:`
    // prefix is pinned so parser-internal improvements don't break the
    // fixture.
    expect(String(stages[0]?.details?.error)).toMatch(/^parsePlist:/);
    expect(stages[0]?.details?.truncated).toBe(true);
    expect(stages[0]?.details?.xmlBytes).toBe(500);
  });

  it('exposes the iPod 5G Video nominal capability set (recoverable identity)', () => {
    // The test contract: when SIE parsing fails, the persona's expected
    // capabilities are still the device the USB PID identifies. A future
    // failure that misclassifies the device would fail this assertion.
    expect(expectations.expectedCapabilities).not.toBeNull();
    expect(expectations.expectedCapabilities?.supportsVideo).toBe(true);
    expect(expectations.expectedCapabilities?.artworkMaxResolution).toBe(200);
  });

  it('is marked synthesised in its provenance', () => {
    expect(malformedSysinfo.provenance.source).toBe('synthesised');
  });
});
