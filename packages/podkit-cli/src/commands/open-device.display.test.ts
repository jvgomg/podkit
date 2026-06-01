/**
 * Tests for the device display-name helpers — specifically the
 * per-device override path users opt into via
 * `[devices.<n>] manufacturer = "..."` /
 * `[devices.<n>] productName = "..."` in their TOML.
 *
 * Centerpiece: the AliExpress example. A no-name DAP configured under
 * the `generic` preset should render with the user's chosen vendor +
 * product name in `device add` / `device info` output, even though the
 * underlying preset is shared with every other generic mass-storage
 * device.
 *
 * The display helpers take a whole device-like object (structural
 * `DeviceDisplayInput`) so call sites that already have a `DeviceConfig`
 * in hand don't have to spread its fields manually.
 */
import { describe, it, expect } from 'bun:test';
import { getDeviceTypeDisplayName, getDeviceTypeRichDisplayName } from './open-device.js';

describe('getDeviceTypeDisplayName — preset defaults', () => {
  it('returns the preset productName when no overrides are supplied', () => {
    expect(getDeviceTypeDisplayName({ type: 'echo-mini' })).toBe('Echo Mini');
    expect(getDeviceTypeDisplayName({ type: 'rockbox' })).toBe('Rockbox device');
    expect(getDeviceTypeDisplayName({ type: 'generic' })).toBe('Mass-storage device');
  });

  it('returns "iPod" for ipod / undefined / unknown types', () => {
    expect(getDeviceTypeDisplayName({ type: 'ipod' })).toBe('iPod');
    expect(getDeviceTypeDisplayName(undefined)).toBe('iPod');
    expect(getDeviceTypeDisplayName({ type: 'not-a-real-type' })).toBe('iPod');
  });
});

describe('getDeviceTypeRichDisplayName — preset defaults', () => {
  it('returns "<manufacturer> <productName> (<id>)" by default', () => {
    expect(getDeviceTypeRichDisplayName({ type: 'echo-mini' })).toBe(
      'FiiO Snowsky Echo Mini (echo-mini)'
    );
    expect(getDeviceTypeRichDisplayName({ type: 'rockbox' })).toBe(
      'Rockbox Rockbox device (rockbox)'
    );
    expect(getDeviceTypeRichDisplayName({ type: 'generic' })).toBe(
      'Generic Mass-storage device (generic)'
    );
  });
});

describe('per-device overrides — the AliExpress example', () => {
  // A user with a no-name USB DAP under the `generic` preset wants
  // their device to read "AliExpress USB MP3 player" in
  // `device info` output. They write this in their config:
  //
  //   [devices.mp3player]
  //   type         = "generic"
  //   path         = "/Volumes/USB"
  //   manufacturer = "AliExpress"
  //   productName  = "USB MP3 player"
  //
  // The overrides should win over the preset defaults, but the
  // preset id stays as the `--type` token in the `(generic)` tail
  // so the CLI hint still references the actual type token.
  const aliExpressDevice = {
    type: 'generic',
    manufacturer: 'AliExpress',
    productName: 'USB MP3 player',
  };

  it('rich form uses the user-supplied manufacturer + productName', () => {
    expect(getDeviceTypeRichDisplayName(aliExpressDevice)).toBe(
      'AliExpress USB MP3 player (generic)'
    );
  });

  it('short form uses the user-supplied productName', () => {
    expect(getDeviceTypeDisplayName(aliExpressDevice)).toBe('USB MP3 player');
  });

  it('partial override — only productName supplied — preserves preset manufacturer', () => {
    expect(getDeviceTypeRichDisplayName({ type: 'generic', productName: 'My DAP' })).toBe(
      'Generic My DAP (generic)'
    );
  });

  it('partial override — only manufacturer supplied — preserves preset productName', () => {
    expect(getDeviceTypeRichDisplayName({ type: 'rockbox', manufacturer: "Joe's" })).toBe(
      "Joe's Rockbox device (rockbox)"
    );
  });

  it('overrides also work on top of named presets (not just generic)', () => {
    // A user with multiple Echo Minis might rename one for their family.
    expect(
      getDeviceTypeRichDisplayName({
        type: 'echo-mini',
        manufacturer: 'Sally',
        productName: 'Music player',
      })
    ).toBe('Sally Music player (echo-mini)');
  });

  it('iPod type ignores overrides (display is fixed)', () => {
    // iPod display passes through the libgpod model-name pipeline, not
    // the preset-display helpers. Overrides are silently ignored.
    expect(
      getDeviceTypeRichDisplayName({
        type: 'ipod',
        manufacturer: 'AliExpress',
        productName: 'USB MP3 player',
      })
    ).toBe('iPod');
  });
});
