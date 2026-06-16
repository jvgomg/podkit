import { describe, it, expect } from 'bun:test';
import type { DeviceCapabilities } from '@podkit/core';
import { BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';
import { OutputContext } from '../../output/index.js';
import { BufferSink } from '../../test-utils/buffer-sink.js';
import {
  SYSINFO_MISSING_PROMPT_LINES,
  printIpodDeviceAddSuccess,
  printMassStorageDeviceAddSuccess,
} from './add-render.js';

const IPOD_CAPS: DeviceCapabilities = {
  artworkSources: ['database'],
  artworkMaxResolution: 240,
  supportedAudioCodecs: ['aac', 'mp3'],
  supportsVideo: true,
  audioNormalization: 'soundcheck',
  supportsAlbumArtistBrowsing: false,
};

function makeOut(): { out: OutputContext; stdout: BufferSink } {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = OutputContext.fromGlobalOpts(
    { json: false, quiet: false, verbose: 0, color: false, tips: false, tty: false },
    {},
    { stdout, stderr }
  );
  return { out, stdout };
}

describe('SYSINFO_MISSING_PROMPT_LINES', () => {
  it('exports the three-line prompt verbatim (stability — user-visible)', () => {
    // User-facing copy; treat any change as user-visible. If a future
    // edit lands a wording change deliberately, update both this test
    // and the docs page linked in the third line.
    expect([...SYSINFO_MISSING_PROMPT_LINES]).toEqual([
      'SysInfo/SysInfoExtended is missing — required for syncing this iPod.',
      'podkit can read it from the device firmware over USB.',
      'Learn more: https://jvgomg.github.io/podkit/devices/supported-devices/',
    ]);
  });
});

describe('printIpodDeviceAddSuccess', () => {
  it('renders the checklist when first-device + initialized + firmware written + capabilities', () => {
    const { out, stdout } = makeOut();
    printIpodDeviceAddSuccess(out, {
      name: 'terapod',
      modelDisplay: 'iPod nano (5th Generation)',
      capabilities: IPOD_CAPS,
      firmwareWritten: true,
      isFirstDevice: true,
      initialized: true,
    });
    const lines = stdout.lines();
    expect(lines).toContain('  ✓ SysInfoExtended written');
    expect(lines).toContain('  ✓ Added to config');
    expect(lines).toContain('  ✓ Set as default device');
    expect(lines).toContain('  ✓ Database initialized (iPod nano (5th Generation))');
    expect(lines).toContain('Capabilities:');
    expect(lines).toContain('Done. Try: podkit sync -d terapod --dry-run');
  });

  it('omits firmware-written line when firmwareWritten=false', () => {
    const { out, stdout } = makeOut();
    printIpodDeviceAddSuccess(out, {
      name: 'x',
      modelDisplay: 'iPod',
      capabilities: null,
      firmwareWritten: false,
      isFirstDevice: false,
      initialized: false,
    });
    expect(stdout.text()).not.toContain('SysInfoExtended written');
  });

  it('omits "set as default" when not first device', () => {
    const { out, stdout } = makeOut();
    printIpodDeviceAddSuccess(out, {
      name: 'x',
      modelDisplay: 'iPod',
      capabilities: null,
      firmwareWritten: false,
      isFirstDevice: false,
      initialized: false,
    });
    expect(stdout.text()).not.toContain('Set as default');
  });

  it('omits database-initialized line when initialized=false', () => {
    const { out, stdout } = makeOut();
    printIpodDeviceAddSuccess(out, {
      name: 'x',
      modelDisplay: 'iPod',
      capabilities: null,
      firmwareWritten: false,
      isFirstDevice: false,
      initialized: false,
    });
    expect(stdout.text()).not.toContain('Database initialized');
  });

  it('omits the capabilities block when capabilities is null/undefined', () => {
    const { out, stdout } = makeOut();
    printIpodDeviceAddSuccess(out, {
      name: 'x',
      modelDisplay: 'iPod',
      capabilities: null,
      firmwareWritten: false,
      isFirstDevice: false,
      initialized: false,
    });
    expect(stdout.text()).not.toContain('Capabilities:');
  });

  it('always emits "Added to config" and the Done hint with device name', () => {
    const { out, stdout } = makeOut();
    printIpodDeviceAddSuccess(out, {
      name: 'mypod',
      modelDisplay: 'iPod',
      capabilities: null,
      firmwareWritten: false,
      isFirstDevice: false,
      initialized: false,
    });
    expect(stdout.text()).toContain('  ✓ Added to config');
    expect(stdout.text()).toContain('Done. Try: podkit sync -d mypod --dry-run');
  });
});

describe('printMassStorageDeviceAddSuccess', () => {
  it('renders "Created config file" on first save + "Set as default" + Next steps', () => {
    const { out, stdout } = makeOut();
    printMassStorageDeviceAddSuccess(out, {
      name: 'echo',
      deviceType: 'echo-mini',
      configResult: { created: true, configPath: '/tmp/podkit.toml' },
      isFirstDevice: true,
      presets: BUILT_IN_PRESETS,
    });
    const text = stdout.text();
    expect(text).toContain('Created config file: /tmp/podkit.toml');
    expect(text).toContain('Device "echo" added to config (Echo Mini).');
    expect(text).toContain('Set as default device.');
    expect(text).toContain('Next steps:');
    expect(text).toContain('podkit collection add');
    expect(text).toContain('podkit sync');
  });

  it('renders "Updated config file" when configResult.created=false', () => {
    const { out, stdout } = makeOut();
    printMassStorageDeviceAddSuccess(out, {
      name: 'echo',
      deviceType: 'echo-mini',
      configResult: { created: false, configPath: '/tmp/podkit.toml' },
      isFirstDevice: false,
      presets: BUILT_IN_PRESETS,
    });
    const text = stdout.text();
    expect(text).toContain('Updated config file: /tmp/podkit.toml');
    expect(text).not.toContain('Created config file');
  });

  it('omits "Set as default" when isFirstDevice=false', () => {
    const { out, stdout } = makeOut();
    printMassStorageDeviceAddSuccess(out, {
      name: 'echo',
      deviceType: 'generic',
      configResult: { created: false, configPath: '/x' },
      isFirstDevice: false,
      presets: BUILT_IN_PRESETS,
    });
    expect(stdout.text()).not.toContain('Set as default');
  });
});
