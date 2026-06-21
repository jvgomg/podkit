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
import { BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';
import { displayForConfig as coreDisplayForConfig } from '@podkit/core';
import {
  getDeviceTypeDisplayName as _getDeviceTypeDisplayName,
  getDeviceTypeRichDisplayName as _getDeviceTypeRichDisplayName,
  displayForConfig as cliDisplayForConfig,
} from './open-device.js';

// These tests pin the built-in preset baseline. The helpers now require an
// explicit registry; tests bind to BUILT_IN_PRESETS via wrappers so the
// assertions read the same as before the registry threading landed.
function getDeviceTypeDisplayName(device: Parameters<typeof _getDeviceTypeDisplayName>[0]) {
  return _getDeviceTypeDisplayName(device, BUILT_IN_PRESETS);
}
function getDeviceTypeRichDisplayName(device: Parameters<typeof _getDeviceTypeRichDisplayName>[0]) {
  return _getDeviceTypeRichDisplayName(device, BUILT_IN_PRESETS);
}

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

  // The display helpers accept either raw-string overrides (the
  // `DeviceConfig` shape) or `{ value: string }` wrappers from
  // `ResolvedDeviceSettings`. Both forms must produce the same label so
  // call sites can pass whichever they have without projecting.
  it('accepts Resolved-shaped fields from ResolvedDeviceSettings', () => {
    expect(
      getDeviceTypeRichDisplayName({
        type: 'generic',
        manufacturer: { value: 'AliExpress' },
        productName: { value: 'USB MP3 player' },
      })
    ).toBe('AliExpress USB MP3 player (generic)');
  });

  it('accepts mixed raw + Resolved fields', () => {
    // A future caller might compose from two sources; the helper
    // doesn't care which arm of the union each field uses.
    expect(
      getDeviceTypeRichDisplayName({
        type: 'rockbox',
        manufacturer: { value: "Joe's" },
        productName: 'Custom Build',
      })
    ).toBe("Joe's Custom Build (rockbox)");
  });
});

// The CLI keeps a local mirror of core's `displayForConfig` because
// `open-device.ts` must stay free of static `@podkit/core` value imports
// (core's index transitively loads the libgpod native bindings). Two copies
// of the same label vocabulary can drift — this block imports BOTH and pins
// them to identical output, so editing one without the other fails CI.
describe('displayForConfig — CLI mirror is byte-identical to core', () => {
  const sweep: Array<Parameters<typeof cliDisplayForConfig>[0]> = [
    undefined,
    { type: 'ipod' },
    { type: 'not-a-real-type' },
    { type: 'echo-mini' },
    { type: 'rockbox' },
    { type: 'generic' },
    { type: 'generic', manufacturer: 'AliExpress', productName: 'USB MP3 player' },
    { type: 'generic', productName: 'My DAP' },
    { type: 'rockbox', manufacturer: "Joe's" },
    { type: 'echo-mini', manufacturer: 'Sally', productName: 'Music player' },
    {
      type: 'generic',
      manufacturer: { value: 'AliExpress' },
      productName: { value: 'USB MP3 player' },
    },
    { type: 'rockbox', manufacturer: { value: "Joe's" }, productName: 'Custom Build' },
    { type: 'ipod', manufacturer: 'AliExpress', productName: 'USB MP3 player' },
  ];

  for (const input of sweep) {
    it(`matches core for ${JSON.stringify(input)}`, () => {
      const cli = cliDisplayForConfig(input, BUILT_IN_PRESETS);
      const core = coreDisplayForConfig(input, BUILT_IN_PRESETS);
      expect(cli).toEqual(core);
    });
  }
});
