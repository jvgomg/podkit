/**
 * Focused tests for user-defined mass-storage preset rendering in
 * `renderDeviceScan`. Pinned in their own file so they avoid the
 * `@podkit/device-testing` dependency that the sibling `*.unit.test.ts`
 * pulls in (and which is unavailable in some test environments).
 */
import { describe, expect, it } from 'bun:test';
import { definePreset, BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';
import {
  renderDeviceScan,
  type DeviceScanInput,
  type ConfiguredDeviceSummary,
} from './device-scan-render.js';

function emptyInput(overrides: Partial<DeviceScanInput> = {}): DeviceScanInput {
  return {
    discovered: [],
    configuredDevices: [],
    isSupportedPlatform: true,
    presets: BUILT_IN_PRESETS,
    ...overrides,
  };
}

const walkman = definePreset({
  id: 'my-walkman',
  extends: 'generic',
  manufacturer: 'Sony',
  productName: 'NW-A105',
});

describe('renderDeviceScan — user-defined preset surfaces through the merged registry', () => {
  it('renders the user preset productName for a configured-but-not-detected device', () => {
    const configured: ConfiguredDeviceSummary[] = [
      { name: 'walkman', type: 'my-walkman', path: '/Volumes/MyWalkman' },
    ];
    const lines = renderDeviceScan(
      emptyInput({
        configuredDevices: configured,
        presets: { 'my-walkman': walkman, ...BUILT_IN_PRESETS },
      })
    );
    const joined = lines.join('\n');
    expect(joined).toContain('Not detected:');
    expect(joined).toContain('walkman');
    expect(joined).toContain('NW-A105');
    // The 'iPod' fallback must not be rendered for a user-preset-typed device
    // once the merged registry is threaded.
    expect(joined).not.toMatch(/walkman\s*\(iPod\)/);
  });

  it('falls back to "iPod" when presets is omitted (default-built-in behaviour)', () => {
    const lines = renderDeviceScan(
      emptyInput({
        configuredDevices: [{ name: 'walkman', type: 'my-walkman' }],
      })
    );
    // No presets passed → user preset id unknown → 'iPod' fallback. Pins
    // the documented contract so call sites that DO have user presets
    // know they must thread `mergedPresets(config)`.
    expect(lines.join('\n')).toContain('walkman (iPod)');
  });

  it('renders built-in echo-mini correctly with or without an explicit presets map', () => {
    const summary: ConfiguredDeviceSummary = {
      name: 'echo',
      type: 'echo-mini',
      path: '/Volumes/Echo',
    };
    // Without an explicit registry the display helper still consults its
    // BUILT_IN_PRESETS default — confirms built-ins keep working in the
    // absence of any user-supplied presets.
    const withoutPresets = renderDeviceScan(emptyInput({ configuredDevices: [summary] }));
    expect(withoutPresets.join('\n')).toContain('Echo Mini');

    const withPresets = renderDeviceScan(
      emptyInput({ configuredDevices: [summary], presets: BUILT_IN_PRESETS })
    );
    expect(withPresets.join('\n')).toContain('Echo Mini');
  });
});
