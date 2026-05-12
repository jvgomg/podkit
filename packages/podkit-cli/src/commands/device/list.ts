/**
 * `podkit device list` — list configured devices.
 */
import { Command } from 'commander';
import { existsSync } from '../../utils/fs.js';
import { getContext } from '../../context.js';
import type { CoreLoaderDeps } from '../../handler-deps.js';
import { isMassStorageDevice, getDeviceTypeDisplayName } from '../open-device.js';
import { OutputContext } from '../../output/index.js';
import { sortDevicesForDisplay, getDevicePrefix } from './shared.js';
import type { DeviceListOutput } from './output-types.js';

/**
 * Format a table row with consistent column widths
 */
function formatRow(columns: string[], widths: number[]): string {
  return columns.map((col, i) => col.padEnd(widths[i] || 10)).join('  ');
}

/**
 * Dependency injection seam for `runDeviceList`. Tests pass stubs to avoid
 * real USB walks. Note: list intentionally catches core-load failures
 * (silent fallback to "no detection"), so it does NOT use the throw-style
 * `loadCoreOrFail` helper for the manager probe — production wraps that
 * `import()` in its own try/catch.
 */
export interface DeviceListDeps extends CoreLoaderDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
  /** Override the libgpod-node native binding (returns undefined if unavailable). */
  loadLibgpod?: () => Promise<typeof import('@podkit/libgpod-node') | undefined>;
}

export const listSubcommand = new Command('list')
  .description('list configured devices')
  .action(async () => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runDeviceList(out);
  });

export async function runDeviceList(out: OutputContext, deps: DeviceListDeps = {}): Promise<void> {
  const { config } = getContext();

  const devices = config.devices || {};
  const defaultDevice = config.defaults?.device;
  const deviceNames = Object.keys(devices);

  if (deviceNames.length === 0) {
    out.result<DeviceListOutput>({ success: true, devices: [], defaultDevice: undefined }, () =>
      out.print("No devices configured. Run 'podkit device add -d <name>' to add one.")
    );
    return;
  }

  const loadCore = deps.loadCore ?? (() => import('@podkit/core'));

  // Probe for `@podkit/core` once. Failures here are non-fatal: list still
  // renders config-only data. When the probe succeeds, the resolved module
  // is reused for capability lookup below — avoiding a second import and
  // making the failure mode (no detection, no capabilities) consistent.
  let coreOrNull: typeof import('@podkit/core') | undefined;
  try {
    coreOrNull = await loadCore();
  } catch {
    // Core not available — skip detection and capabilities
  }

  // Detect connected iPods (lightweight — no readiness pipeline).
  const connectedUuids = new Map<string, { mountPoint?: string }>();
  if (coreOrNull) {
    try {
      const manager = (deps.getDeviceManager ?? coreOrNull.getDeviceManager)();
      if (manager.isSupported) {
        const ipods = await manager.findIpodDevices();
        for (const ipod of ipods) {
          if (ipod.volumeUuid) {
            connectedUuids.set(ipod.volumeUuid.toUpperCase(), {
              mountPoint: ipod.isMounted ? ipod.mountPoint : undefined,
            });
          }
        }
      }
    } catch {
      // Manager unavailable — skip detection
    }
  }

  // Also check mass-storage device paths
  const connectedPaths = new Set<string>();
  for (const [, deviceConfig] of Object.entries(devices)) {
    if (
      isMassStorageDevice(deviceConfig.type) &&
      deviceConfig.path &&
      existsSync(deviceConfig.path)
    ) {
      connectedPaths.add(deviceConfig.path);
    }
  }

  // Resolve capabilities and settings for each device
  const { resolveGlobalConfig, resolveDeviceSettings, formatResolved, formatGlobalResolved } =
    await import('../../config/resolve.js');
  const resolveCapabilities = coreOrNull?.resolveCapabilities;
  const identifyCapabilities = coreOrNull?.identifyCapabilities;
  const { resolveIpodModel } = await import('@podkit/devices-ipod');

  // Import Device class for lightweight capability queries (no database needed)
  const loadLibgpod =
    deps.loadLibgpod ??
    (async () => {
      try {
        return await import('@podkit/libgpod-node');
      } catch {
        return undefined;
      }
    });
  const libgpod = await loadLibgpod();
  const deviceFromMountPoint = libgpod?.deviceFromMountPoint;

  const globalResolved = resolveGlobalConfig(config);

  const resolvedDevices: ReturnType<typeof resolveDeviceSettings>[] = [];

  for (const name of deviceNames) {
    const deviceConfig = devices[name]!;
    const type = deviceConfig.type ?? 'ipod';
    const isDefault = name === defaultDevice;

    // Determine connection status
    let connected = false;
    let capabilities: import('@podkit/core').DeviceCapabilities | null = null;

    if (type === 'ipod') {
      const uuid = deviceConfig.volumeUuid?.toUpperCase();
      const connInfo = uuid ? connectedUuids.get(uuid) : undefined;
      connected = connInfo !== undefined;

      if (connected && connInfo?.mountPoint && deviceFromMountPoint) {
        // Connected iPod — bridge libgpod data → IpodModel → capabilities
        try {
          const dev = deviceFromMountPoint(connInfo.mountPoint);
          const libgpodCaps = dev.getCapabilities();
          const model = resolveIpodModel({
            modelNumStr: libgpodCaps.modelNumber ?? undefined,
            libgpodGeneration: libgpodCaps.generation,
          });
          if (model && identifyCapabilities) {
            capabilities = identifyCapabilities(model);
          }
          dev.close();
        } catch {
          // Fall through — capabilities remain null
        }
      }
      // Disconnected iPod — capabilities stay null (unknown)
    } else {
      // Mass-storage device — resolve via unified resolveCapabilities
      connected = deviceConfig.path ? connectedPaths.has(deviceConfig.path) : false;
      const massStorageIdentity: import('@podkit/core').MassStorageIdentity = {
        kind: 'mass-storage',
        presetId: type,
      };
      if (resolveCapabilities) {
        try {
          capabilities = resolveCapabilities(massStorageIdentity, {
            overrides: deviceConfig as Partial<import('@podkit/core').DeviceCapabilities>,
          });
        } catch {
          capabilities = null;
        }
      }
    }

    resolvedDevices.push(
      resolveDeviceSettings(config, name, deviceConfig, capabilities, connected, isDefault)
    );
  }

  // Sort: connected first, then default, then alphabetical
  const sorted = sortDevicesForDisplay(resolvedDevices);
  resolvedDevices.length = 0;
  resolvedDevices.push(...sorted);

  // Build JSON output (backward-compatible shape + new resolved fields)
  const deviceList = resolvedDevices.map((d) => ({
    name: d.name,
    isDefault: d.isDefault,
    connected: d.connected,
    type: d.type,
    volumeUuid: devices[d.name]?.volumeUuid,
    volumeName: devices[d.name]?.volumeName,
    quality: d.quality.value,
    qualitySource: d.quality.source,
    audio: d.audio.value,
    audioSource: d.audio.source,
    video: d.video.value,
    videoSource: d.video.source,
    artwork: d.artwork.value,
    artworkSource: d.artwork.source,
  }));

  out.result<DeviceListOutput>({ success: true, devices: deviceList, defaultDevice }, () => {
    // Global config line
    out.print(
      `Global: quality=${formatGlobalResolved(globalResolved.quality)}` +
        `  audio=${formatGlobalResolved(globalResolved.audio)}` +
        `  video=${formatGlobalResolved(globalResolved.video)}` +
        `  artwork=${formatGlobalResolved(globalResolved.artwork)}`
    );
    out.newline();

    const headers = ['NAME', 'TYPE', 'QUALITY', 'AUDIO', 'VIDEO', 'ARTWORK'];
    const widths = [
      Math.max(6, ...resolvedDevices.map((d) => d.name.length + 2)),
      Math.max(6, ...resolvedDevices.map((d) => getDeviceTypeDisplayName(d.type).length)),
      9,
      9,
      9,
      9,
    ];

    out.print('  ' + formatRow(headers, widths));

    for (const d of resolvedDevices) {
      const prefix = getDevicePrefix(d);

      const row = formatRow(
        [
          d.name,
          getDeviceTypeDisplayName(d.type),
          formatResolved(d.quality),
          formatResolved(d.audio),
          formatResolved(d.video),
          formatResolved(d.artwork),
        ],
        widths
      );

      out.print(prefix + row);
    }

    out.newline();
    out.print('● = connected  * = default  [value] = inherited  ✗ = unsupported  ? = unknown');
  });
}
