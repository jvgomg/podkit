/**
 * `podkit device info` — display device configuration and live status.
 */
import { Command } from 'commander';
import { existsSync } from '../../utils/fs.js';
import { getContext } from '../../context.js';
import { CliError, runAction } from '../../errors.js';
import { type CoreLoaderDeps, type OpenDeviceFn } from '../../handler-deps.js';
import { resolveDevicePath, getDeviceIdentity } from '../../device-resolver.js';
import { OutputContext, formatBytes, formatNumber } from '../../output/index.js';
import {
  displayFor as displayForCore,
  formatGeneration,
  validateDevice,
  DEFAULT_LOSSY_STACK,
  DEFAULT_LOSSLESS_STACK,
} from '@podkit/core';
import type { DiscoveredDevice, ReadinessLevel } from '@podkit/core';
import type { ResolvedDeviceCapabilities } from '@podkit/device-types';
import {
  resolveGenerationSupport,
  IPOD_GENERATION_IDS,
  type IpodGenerationId,
} from '@podkit/devices-ipod';
import { openDevice, isMassStorageDevice, displayForConfig } from '../open-device.js';
import { mergedPresets } from '../../config/preset-registry.js';
import { formatReadinessLevel, collectReadinessIssues, printIssues } from '../readiness-display.js';
import { resolveDeviceSettings, type ResolvedDeviceSettings } from '../../config/resolve.js';
import { DeviceErrorCodes } from './error-codes.js';
import {
  resolveDeviceArg,
  getStorageInfo,
  formatSyncTagSummary,
  synthesizePathModeDeviceInfo,
  matchConfiguredDeviceToDiscovered,
  pickCapabilityOverrides,
} from './shared.js';
import type { DeviceInfoOutput, DeviceInfoSuccess } from './output-types.js';
import { printCapabilitySummary, getTranscodedCodecs } from './capability-summary.js';
import {
  SUMMARY_LABEL_WIDTH,
  buildSettingsRows,
  printSettingsZone,
  printSummaryRow,
  printDefaultCollectionRows,
  toDefaultCollectionOutput,
} from './info-render.js';
import { classifyDeviceDefault } from '../../resolvers/default-collection-state.js';

export interface DeviceInfoDeps extends CoreLoaderDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
  /** Override the `openDevice` helper so tests don't need a real iTunesDB. */
  openDevice?: OpenDeviceFn;
}

export const infoSubcommand = new Command('info')
  .description('display device configuration and live status')
  .action(async () => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runDeviceInfo(out));
  });

export async function runDeviceInfo(out: OutputContext, deps: DeviceInfoDeps = {}): Promise<void> {
  const { config: podkitConfig } = getContext();
  const loadCore = deps.loadCore ?? (() => import('@podkit/core'));

  const resolved = resolveDeviceArg();
  if ('error' in resolved) {
    throw new CliError({
      message: resolved.error,
      code: DeviceErrorCodes.DEVICE_NOT_RESOLVED,
    });
  }

  const { resolvedDevice, cliPath, config } = resolved;
  const device = resolvedDevice?.config;
  const deviceName = resolvedDevice?.name;
  const defaultDevice = config.defaults?.device;
  const isDefault = deviceName === defaultDevice;

  // Try to get live status if device is connected
  let liveStatus: DeviceInfoSuccess['status'] | undefined;
  let databaseErrorIsUnexpected = false;
  let resolvedDeviceCapabilities: import('@podkit/core').DeviceCapabilities | undefined;
  let firmwareDeviceCapabilities: import('@podkit/core').DeviceCapabilities | undefined;
  let readinessData: DeviceInfoSuccess['readiness'] | undefined;

  try {
    const core = await loadCore();
    const manager = (deps.getDeviceManager ?? core.getDeviceManager)();
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (cliPath || deviceIdentity) {
      const resolveResult = await resolveDevicePath({
        cliDevice: cliPath,
        deviceIdentity,
        manager,
        requireMounted: true,
        quiet: true,
      });

      if (resolveResult.path && existsSync(resolveResult.path)) {
        // Hold the open device for the entire live-status block: UUID
        // lookup + readiness reuse the already-parsed iTunesDB rather than
        // re-opening it inside checkDatabase. The try/finally guarantees
        // adapter.close() runs even if a later block (UUID, readiness)
        // throws an unexpected exception.
        let openedDeviceResult: Awaited<ReturnType<typeof openDevice>> | undefined;
        try {
          try {
            openedDeviceResult = await (deps.openDevice ?? openDevice)(
              core,
              resolveResult.path,
              device,
              podkitConfig.deviceDefaults,
              mergedPresets(podkitConfig)
            );
            resolvedDeviceCapabilities = openedDeviceResult.capabilities;
            firmwareDeviceCapabilities = openedDeviceResult.firmwareCapabilities;
            const storage = getStorageInfo(resolveResult.path);
            const tracks = openedDeviceResult.adapter.getTracks();
            const musicTracks = tracks.filter((t) => core.isMusicMediaType(t.mediaType));
            const musicCount = musicTracks.length;
            const videoCount = tracks.filter((t) => core.isVideoMediaType(t.mediaType)).length;
            const parsedSyncTags = musicTracks.map((t) => ({
              tag: t.syncTag,
              hasArtwork: t.hasArtwork,
            }));
            const syncTagCount = parsedSyncTags.filter((t) => t.tag !== null).length;
            const syncTagComplete = parsedSyncTags.filter(
              (t) => t.tag !== null && (t.tag.artworkHash || t.hasArtwork === false)
            ).length;
            const syncTagMissingArt = syncTagCount - syncTagComplete;
            const syncTagMissingTransfer = parsedSyncTags.filter(
              (t) => t.tag !== null && !t.tag.transferMode
            ).length;

            liveStatus = {
              mounted: true,
              mountPoint: resolveResult.path,
              musicCount,
              videoCount,
              syncTagCount,
              syncTagComplete,
              syncTagMissingArt,
              syncTagMissingTransfer,
            };

            // iPod-specific model and validation info.
            //
            // The `name` field is fed from the cascade-resolved display name
            // (`assessIpodIdentity` — composes SysInfoExtended + classic
            // SysInfo + USB) when available, falling back to libgpod's view
            // only when the cascade is empty. Pre-TASK-317.03 this used
            // libgpod's `info.device.modelName` directly, which lost the
            // capacity/colour suffix and could leak generic strings.
            if (openedDeviceResult.ipod) {
              const info = openedDeviceResult.ipod.getInfo();
              const deviceValidation = validateDevice(info.device, resolveResult.path);
              let cascadeDisplayName: string | undefined;
              try {
                const assessment = await core.assessIpodIdentity(resolveResult.path);
                cascadeDisplayName = assessment.model?.displayName;
              } catch {
                // Cascade assessment is best-effort — fall back to libgpod.
              }
              liveStatus.model = {
                name: cascadeDisplayName ?? info.device.modelName,
                number: info.device.modelNumber,
                generation: info.device.generation,
                capacity: info.device.capacity,
              };
              liveStatus.capabilities = deviceValidation.capabilities;
              liveStatus.validation = {
                supported: deviceValidation.supported,
                issues: deviceValidation.issues,
                warnings: deviceValidation.warnings,
              };
            }

            // Mass-storage capabilities for JSON output. `firmwareSupportedAudioCodecs`
            // is only set when the firmware list strictly differs from the
            // operational one — most devices (echo-mini, generic) have no diff,
            // and the absence is the signal that the two views are equal.
            if (!openedDeviceResult.ipod && resolvedDeviceCapabilities) {
              const operational = resolvedDeviceCapabilities.supportedAudioCodecs;
              const firmware = firmwareDeviceCapabilities?.supportedAudioCodecs;
              const hasFirmwareDiff = getTranscodedCodecs(firmware, operational).length > 0;
              liveStatus.massStorageCapabilities = {
                supportedAudioCodecs: [...operational],
                ...(hasFirmwareDiff && firmware
                  ? { firmwareSupportedAudioCodecs: [...firmware] }
                  : {}),
                artworkSources: [...resolvedDeviceCapabilities.artworkSources],
                artworkMaxResolution: resolvedDeviceCapabilities.artworkMaxResolution,
                supportsVideo: resolvedDeviceCapabilities.supportsVideo,
                audioNormalization: resolvedDeviceCapabilities.audioNormalization,
                supportsAlbumArtistBrowsing: resolvedDeviceCapabilities.supportsAlbumArtistBrowsing,
              };
            }

            if (storage) {
              liveStatus.storage = {
                used: storage.used,
                total: storage.total,
                free: storage.free,
                percentUsed: Math.round((storage.used / storage.total) * 100),
              };
            }
          } catch (err) {
            liveStatus = { mounted: true, mountPoint: resolveResult.path };
            const message = err instanceof Error ? err.message : String(err);
            liveStatus.databaseError = message;
            // IpodError on iPod devices is expected (empty/uninitialized).
            // Key off the opened-device result rather than re-deriving the kind
            // from config. When the open itself threw before assignment, an
            // `IpodError` can only have come from the iPod database-open path
            // (MassStorageAdapter.open never throws `IpodError`), so an absent
            // result with this error class is, by construction, an iPod.
            const isIpod = openedDeviceResult?.isIpodDevice ?? true;
            if (err instanceof core.IpodError && isIpod) {
              // Database not found or corrupt — expected on empty/uninitialized iPods
            } else {
              databaseErrorIsUnexpected = true;
            }
          }

          // Look up filesystem UUID for the mount point. Single diskutil-info
          // call (cheap); avoids the full scan({ kinds: ['ipod'] }) walk below.
          if (liveStatus?.mounted && manager.isSupported) {
            try {
              const uuid = (await manager.locate({ path: resolveResult.path }))?.volumeUuid ?? null;
              if (uuid) {
                liveStatus.volumeUuid = uuid;
              }
            } catch {
              // Gracefully skip UUID display when extraction fails
            }
          }

          // Run readiness check for iPod devices (skip mass-storage). In path
          // mode we synthesize the PlatformDeviceInfo from data we already
          // have rather than calling manager.scan({ kinds: ['ipod'] }) — that's a
          // full disk enumeration which on macOS dispatches diskutil
          // subprocesses per attached disk. We then lift it through
          // `ipodFromBlock` so the readiness dispatch sees a uniform
          // DiscoveredDevice shape.
          // iPod-readiness gate keys off the opened-device result. When the
          // open failed (no result) we fall back to the config-derived kind so
          // readiness still runs for an iPod whose database wouldn't open
          // (empty / uninitialised) — `checkReadiness` probes sysinfo without
          // needing the parsed iTunesDB handle.
          const readinessIsIpod =
            openedDeviceResult?.isIpodDevice ?? !isMassStorageDevice(device?.type);
          if (liveStatus?.mounted && readinessIsIpod && manager.isSupported) {
            try {
              const matchingBlock =
                resolveResult.deviceInfo ??
                synthesizePathModeDeviceInfo(resolveResult.path, liveStatus.volumeUuid);
              const readiness = await core.checkReadiness({
                device: core.ipodFromBlock(matchingBlock),
                ipod: openedDeviceResult?.ipod,
              });
              const bestModel = readiness.deviceModel ?? readiness.usbModel;
              readinessData = {
                level: readiness.level,
                stages: readiness.stages.map((s) => ({
                  stage: s.stage,
                  status: s.status,
                  summary: s.summary,
                  ...(s.details ? { details: s.details } : {}),
                })),
                ...(bestModel ? { model: bestModel } : {}),
                ...(readiness.summary ? { summary: readiness.summary } : {}),
                ...(readiness.unsupported ? { unsupported: readiness.unsupported } : {}),
              };
            } catch {
              // Gracefully skip readiness if it fails
            }
          }
        } finally {
          // Guaranteed close, even if UUID/readiness blocks throw.
          // adapter.close() owns the underlying ipod handle.
          openedDeviceResult?.adapter.close();
        }
      } else if (resolveResult.deviceInfo) {
        liveStatus = { mounted: false };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    liveStatus = { mounted: false, databaseError: message };
    databaseErrorIsUnexpected = true;
  }

  // ── Discovery + resolved settings/capabilities ───────────────────────────
  //
  // Compose two cascades for the new Settings + Capabilities sections:
  //   1. `resolveDeviceSettings` — config-cascade with provenance
  //      (device → device-quality → global → global-quality → default).
  //   2. `resolveCapabilitiesResolved` — capability-cascade with provenance
  //      (device-config → device-defaults → firmware → preset/generation).
  //
  // Discovery (`discoverConnectedDevices`) is deferred to a LAZY lookup
  // only invoked when the cheap header-anchor paths return undefined — the
  // mounted-iPod / known-preset paths already give us a label equivalent
  // to `displayFor(d).rich`, so the USB walk would be pure overhead on the
  // common case (and noisy on Linux without udev permissions). Discovery
  // fires only for cases where the rich anchor needs USB-side context:
  // USB-only iPod (powered up, no mounted volume), iPod in restore mode,
  // an Echo Mini whose firmware hasn't switched to mass-storage mode, or
  // a configured device whose preset id is unknown to us.
  let resolvedSettings: ResolvedDeviceSettings | undefined;
  let resolvedCaps: ResolvedDeviceCapabilities | undefined;
  let lookupDiscoveredDevice: (() => Promise<DiscoveredDevice | undefined>) | undefined;
  if (device && deviceName) {
    try {
      const core = await loadCore();
      const manager = (deps.getDeviceManager ?? core.getDeviceManager)();

      // Lazy discovery factory — memoised inside so multiple anchor probes
      // share one walk. Returns `undefined` when discovery is unsupported
      // (Windows) or throws (libusb permission denial, missing /sys, …).
      let discoveryRun: Promise<DiscoveredDevice | undefined> | undefined;
      lookupDiscoveredDevice = () => {
        if (!discoveryRun) {
          discoveryRun = (async () => {
            if (!manager.isSupported) return undefined;
            try {
              const discovered = await core.discoverConnectedDevices({
                deviceManager: manager,
                massStoragePresets: mergedPresets(podkitConfig),
              });
              return matchConfiguredDeviceToDiscovered(device, discovered);
            } catch {
              return undefined;
            }
          })();
        }
        return discoveryRun;
      };

      const presets = mergedPresets(podkitConfig);
      const presetDisplay = (() => {
        if (!device.type || device.type === 'ipod') return undefined;
        const preset = presets[device.type];
        return preset
          ? { manufacturer: preset.manufacturer, productName: preset.productName }
          : undefined;
      })();
      resolvedSettings = resolveDeviceSettings(
        podkitConfig,
        deviceName,
        device,
        resolvedDeviceCapabilities ?? null,
        liveStatus?.mounted === true,
        isDefault,
        presetDisplay
      );

      if (isMassStorageDevice(device.type) && device.type) {
        try {
          resolvedCaps = core.resolveCapabilitiesResolved(
            { kind: 'mass-storage', presetId: device.type },
            { presets, deviceConfigOverrides: pickCapabilityOverrides(device) }
          );
        } catch {
          // Resolver failure (e.g. unknown preset id) — Settings section
          // still renders config-side fields without capability rows.
        }
      }
    } catch {
      // Core unavailable — fall through to legacy rendering paths.
    }
  }

  // Resolve the discovered device ONLY when we need a header anchor the
  // cheap paths couldn't provide. Mounted iPods get their model via
  // `liveStatus.model.name` (cascade-resolved); configured mass-storage
  // devices get theirs via `displayForConfig(...).rich`. Both cover the
  // common case without a USB walk.
  let discoveredDevice: DiscoveredDevice | undefined;
  if (lookupDiscoveredDevice && device) {
    const isMassStorage = isMassStorageDevice(device.type);
    const havePresetAnchor =
      isMassStorage && device.type && mergedPresets(podkitConfig)[device.type] !== undefined;
    const haveCascadeAnchor = !isMassStorage && Boolean(liveStatus?.model?.name);
    if (!havePresetAnchor && !haveCascadeAnchor) {
      discoveredDevice = await lookupDiscoveredDevice();
    }
  }

  // Compute transform warnings for JSON output
  let deviceTransformWarnings: Array<{ type: string; message: string }> | undefined;
  if (
    device &&
    isMassStorageDevice(device.type) &&
    resolvedDeviceCapabilities &&
    device.transforms?.cleanArtists
  ) {
    const { resolveCleanArtistsTransform, computeTransformWarnings } =
      await import('../transform-warnings.js');
    const deviceCleanArtists = device.transforms.cleanArtists as Partial<
      import('@podkit/core').CleanArtistsConfig
    >;
    const effectiveTransforms: import('@podkit/core').TransformsConfig = {
      cleanArtists: {
        ...podkitConfig.transforms.cleanArtists,
        ...deviceCleanArtists,
      },
    };
    const resolution = resolveCleanArtistsTransform(
      effectiveTransforms,
      resolvedDeviceCapabilities.supportsAlbumArtistBrowsing,
      true
    );
    const hasCapabilityOverride = device.supportsAlbumArtistBrowsing !== undefined;
    const warnings = computeTransformWarnings(
      resolution,
      resolvedDeviceCapabilities.supportsAlbumArtistBrowsing,
      hasCapabilityOverride
    );
    if (warnings.length > 0) {
      deviceTransformWarnings = warnings.map((w) => ({ type: w.type, message: w.message }));
    }
  }

  // JSON envelope: top-level `quality` / `audioQuality` / `videoQuality` /
  // `artwork` removed in favour of the structured `settings` block — every
  // field carries its `{ value, source }` provenance there, matching the
  // shape `device list` already emits per row. Breaking change for JSON
  // consumers; see the changeset for migration notes (read `settings.audio.value`
  // instead of `audioQuality`, etc).
  // Resolved default collections (config-state, provenance-carrying). Classified
  // here so both the JSON envelope and the text Settings section share one
  // computation. The classifier surfaces the full tri-state (name / missing /
  // inherited / none / empty) that the sync resolver deliberately drops.
  const defaultMusicState = device
    ? classifyDeviceDefault(podkitConfig, device, 'music')
    : undefined;
  const defaultVideoState = device
    ? classifyDeviceDefault(podkitConfig, device, 'video')
    : undefined;

  const settingsJson =
    resolvedSettings && device && defaultMusicState && defaultVideoState
      ? {
          quality: resolvedSettings.quality,
          audio: resolvedSettings.audio,
          video: resolvedSettings.video,
          artwork: resolvedSettings.artwork,
          checkArtwork: resolvedSettings.checkArtwork,
          skipUpgrades: resolvedSettings.skipUpgrades,
          encoding: resolvedSettings.encoding,
          transferMode: resolvedSettings.transferMode,
          defaultMusic: toDefaultCollectionOutput(defaultMusicState),
          defaultVideo: toDefaultCollectionOutput(defaultVideoState),
          ...(resolvedSettings.manufacturer ? { manufacturer: resolvedSettings.manufacturer } : {}),
          ...(resolvedSettings.productName ? { productName: resolvedSettings.productName } : {}),
          ...(resolvedCaps
            ? {
                capabilities: {
                  supportedAudioCodecs: resolvedCaps.supportedAudioCodecs,
                  artworkSources: resolvedCaps.artworkSources,
                  artworkMaxResolution: resolvedCaps.artworkMaxResolution,
                  supportsVideo: resolvedCaps.supportsVideo,
                  audioNormalization: resolvedCaps.audioNormalization,
                  supportsAlbumArtistBrowsing: resolvedCaps.supportsAlbumArtistBrowsing,
                },
              }
            : {}),
        }
      : undefined;

  out.result<DeviceInfoOutput>(
    {
      success: true,
      device: device
        ? {
            name: deviceName!,
            volumeUuid: device.volumeUuid,
            volumeName: device.volumeName,
            transforms: device.transforms as unknown as Record<string, unknown> | undefined,
            transformWarnings: deviceTransformWarnings,
            isDefault,
          }
        : undefined,
      ...(settingsJson ? { settings: settingsJson } : {}),
      status: liveStatus,
      readiness: readinessData,
    },
    () => {
      // Human-readable output — Summary zone then Issues zone
      const isMassStorage = device ? isMassStorageDevice(device.type) : false;
      const infoIssues: import('../readiness-display.js').ReadinessIssue[] = [];
      const cmdTarget = deviceName || cliPath || 'device';

      // ── Summary zone ──────────────────────────────────────────────
      //
      // Header anchor: <name>[ (default)]  —  <rich display>. The rich
      // display comes from `displayFor(discoveredDevice).rich` when discovery
      // matched a live device — same dispatcher `device scan` / `device add`
      // use, so labels stay consistent across commands. Falls back to the
      // legacy display helpers for disconnected / path-mode cases. The cheap
      // anchor sources (cascade name from `assessIpodIdentity`, preset rich
      // name) are tried first to avoid a USB walk; discovery is only
      // consulted when neither produced a label.
      if (device) {
        const presets = mergedPresets(podkitConfig);
        const anchor = (() => {
          if (discoveredDevice) return displayForCore(discoveredDevice).rich;
          if (isMassStorage) return displayForConfig(device, presets).rich;
          return liveStatus?.model?.name;
        })();
        const defaultMarker = isDefault ? ' (default)' : '';
        if (anchor) {
          out.print(`${deviceName}${defaultMarker}  —  ${anchor}`);
        } else {
          out.print(`Device: ${deviceName}${defaultMarker}`);
        }
        if (device.volumeUuid) {
          printSummaryRow(out, 'Volume UUID', device.volumeUuid);
        }
        if (device.volumeName) {
          printSummaryRow(out, 'Volume Name', device.volumeName);
        }
      } else if (cliPath) {
        out.print(`Device: ${cliPath} (path mode)`);
        if (liveStatus?.volumeUuid) {
          printSummaryRow(out, 'Volume UUID', liveStatus.volumeUuid);
        }
      }

      if (liveStatus) {
        if (liveStatus.mounted && liveStatus.mountPoint) {
          printSummaryRow(out, 'Status', `Mounted at ${liveStatus.mountPoint}`);
        } else if (liveStatus.mounted === false) {
          printSummaryRow(out, 'Status', 'Not mounted');
        }

        // Model line — prefer IpodModel (has color) over database model
        if (!isMassStorage && readinessData?.model) {
          printSummaryRow(out, 'Model', readinessData.model.displayName);
        } else if (!isMassStorage && liveStatus.model) {
          const capacityStr =
            liveStatus.model.capacity > 0 ? ` (${liveStatus.model.capacity}GB)` : '';
          const genStr = formatGeneration(liveStatus.model.generation);
          printSummaryRow(out, 'Model', `${liveStatus.model.name}${capacityStr} - ${genStr}`);
        } else if (!isMassStorage && !liveStatus.model && liveStatus.mounted) {
          printSummaryRow(out, 'Model', 'Unknown \u2014 SysInfo missing');
        }

        // Support line \u2014 the resolved generation's access tier plus its
        // verification provenance. Purely informational: `access` gates
        // behavior elsewhere, `verified` gates nothing and rides along as a
        // confidence badge (e.g. `read-only (hardware-verified)`).
        if (!isMassStorage && readinessData?.model) {
          const genId = readinessData.model.generationId;
          if ((IPOD_GENERATION_IDS as readonly string[]).includes(genId)) {
            const support = resolveGenerationSupport(genId as IpodGenerationId);
            const confidence = support.verified === 'hardware' ? 'hardware-verified' : 'inferred';
            printSummaryRow(out, 'Support', `${support.access} (${confidence})`);
          }
        }

        // Readiness line — short status only
        if (!isMassStorage && readinessData) {
          const levelLabel =
            readinessData.level === 'ready'
              ? 'Ready'
              : formatReadinessLevel(readinessData.level as ReadinessLevel, cmdTarget);
          printSummaryRow(out, 'Readiness', levelLabel);

          // Surface the canonical rejection reason inline so the user does
          // not have to dig into Issues for the most important detail.
          if (readinessData.level === 'unsupported' && readinessData.unsupported) {
            printSummaryRow(out, 'Reason', readinessData.unsupported.headline);
            if (readinessData.unsupported.details) {
              // Continuation lines align to the value column established by
              // `printSummaryRow` (2 leading spaces + SUMMARY_LABEL_WIDTH + 2
              // padding). Hand-rolling the indent here used to drift —
              // compute it from the same constant to keep the columns lined
              // up if SUMMARY_LABEL_WIDTH ever changes.
              const indent = ' '.repeat(2 + SUMMARY_LABEL_WIDTH + 2);
              for (const line of readinessData.unsupported.details) {
                out.print(`${indent}${line}`);
              }
            }
          }

          // Collect readiness issues for the Issues zone
          const readinessIssues = collectReadinessIssues(
            readinessData.stages as import('@podkit/core').ReadinessStageResult[],
            cmdTarget
          );
          infoIssues.push(...readinessIssues);
        }

        // Collect validation issues for the Issues zone (iPod only)
        if (!isMassStorage && liveStatus.validation) {
          for (const issue of liveStatus.validation.issues) {
            infoIssues.push({
              marker: issue.type === 'unsupported_device' ? '\u2717' : '!',
              label: 'Validation',
              summary: issue.message,
              details: [],
              ...(issue.suggestion ? { docsUrl: undefined, fixCommand: undefined } : {}),
            });
          }
        }

        // ── Capabilities section ─────────────────────────────────
        //
        // First-class section with its own anchored header — `displayFor`
        // dispatches on the matched DiscoveredDevice's kind so iPod / mass-
        // storage / unsupported all read consistently. Falls back to plain
        // `Capabilities:` when no DiscoveredDevice is present (path mode,
        // disconnected). Section break is emitted as a real `out.newline()`
        // before the print, not embedded in the title string — `\n` inside
        // a single `print` doesn't compose cleanly across output sinks.
        const isCapsPeerSection = Boolean(discoveredDevice);
        const capsSectionTitle = (() => {
          if (!discoveredDevice) return 'Capabilities:';
          const display = displayForCore(discoveredDevice);
          const suffix = display.source === 'preset' ? ' preset' : '';
          return `Capabilities (from ${display.short}${suffix})`;
        })();
        if (isCapsPeerSection) out.newline();
        if (
          !isMassStorage &&
          resolvedDeviceCapabilities &&
          liveStatus.capabilities &&
          liveStatus.model
        ) {
          printCapabilitySummary(
            out,
            resolvedDeviceCapabilities,
            {
              kind: 'ipod',
              modelDisplay: formatGeneration(liveStatus.model.generation),
              supportsPodcast: liveStatus.capabilities.podcast,
            },
            { sectionTitle: capsSectionTitle }
          );
        } else if (!isMassStorage && !liveStatus.model && liveStatus.mounted) {
          printSummaryRow(out, 'Capabilities', 'Music only (model unknown)');
        } else if (isMassStorage && resolvedDeviceCapabilities) {
          printCapabilitySummary(
            out,
            resolvedDeviceCapabilities,
            { kind: 'mass-storage' },
            {
              sectionTitle: capsSectionTitle,
              firmwareCapabilities: firmwareDeviceCapabilities,
              resolved: resolvedCaps,
            }
          );
        }

        if (liveStatus.storage) {
          const usedStr = formatBytes(liveStatus.storage.used);
          const totalStr = formatBytes(liveStatus.storage.total);
          out.print(
            `  Storage:       ${usedStr} used / ${totalStr} total (${liveStatus.storage.percentUsed}%)`
          );
        }

        if (liveStatus.musicCount !== undefined) {
          const trackCount = liveStatus.musicCount;
          const syncTagCount = liveStatus.syncTagCount ?? 0;
          const complete = liveStatus.syncTagComplete ?? 0;
          const missingArt = liveStatus.syncTagMissingArt ?? 0;
          const noTag = trackCount - syncTagCount;
          const missingTransfer = liveStatus.syncTagMissingTransfer ?? 0;

          out.print(
            `  Music:         ${formatSyncTagSummary(trackCount, complete, missingArt, noTag, missingTransfer)}`
          );
        }
        if (liveStatus.videoCount !== undefined && liveStatus.videoCount > 0) {
          out.print(`  Video:         ${formatNumber(liveStatus.videoCount)} videos`);
        }

        if (liveStatus.databaseError) {
          out.newline();
          if (databaseErrorIsUnexpected) {
            const errLabel = isMassStorage ? 'Cannot read device' : 'Cannot read iPod database';
            out.error(`${errLabel}: ${liveStatus.databaseError}`);
          } else {
            out.print(`  Database:      Could not read (${liveStatus.databaseError})`);
          }
        }
      }

      // ── Settings section ──────────────────────────────────────
      //
      // Every row goes through `formatResolvedRow` (via `printSettingsZone`),
      // so inheritance markers (`[bracketed]`), unsupported / unknown symbols,
      // and the `from <provenance>` tail are uniform across the section. The
      // old hand-rolled rows (`Quality: (not set)`, raw mass-storage override
      // lines with `(override)` suffix) collapse into one loop driven by the
      // resolver's `Resolved<…>` outputs.
      if (device && resolvedSettings) {
        // Output-codec stack — intersection of the configured codec stack
        // with the device's supported codecs. Sourced from device-level
        // `codec` override when present; otherwise the global stack.
        const outputCodecSource = device.codec ? 'device' : 'global';
        const codecConfig = device.codec ?? podkitConfig.codec;
        const lossyStack = codecConfig?.lossy ?? DEFAULT_LOSSY_STACK;
        const losslessStack = codecConfig?.lossless ?? DEFAULT_LOSSLESS_STACK;
        const deviceCodecs = new Set<string>(
          resolvedDeviceCapabilities?.supportedAudioCodecs ?? []
        );
        const seen = new Set<string>();
        const supportedCodecs = [...lossyStack, ...losslessStack].filter((c) => {
          if (c === 'source' || seen.has(c)) return false;
          seen.add(c);
          return deviceCodecs.has(c);
        });
        const outputCodecRow = {
          value: supportedCodecs.join(', ') || 'none',
          source: outputCodecSource,
        };

        const rows = buildSettingsRows(resolvedSettings, resolvedCaps, outputCodecRow);
        printSettingsZone(out, rows);

        // Resolved default collections — config-state with provenance
        // (plain / [bracketed-inherited] / none / — / ghost (not found)).
        if (defaultMusicState && defaultVideoState) {
          printDefaultCollectionRows(out, defaultMusicState, defaultVideoState);
        }

        // Transforms block kept separate — runtime toggles, not capabilities;
        // `enabled` / `disabled` vocabulary is correct here.
        if (device.transforms) {
          out.newline();
          out.print('Transforms');
          for (const [transformName, transformConfig] of Object.entries(device.transforms)) {
            const cfg = transformConfig as Record<string, unknown>;
            const enabled = cfg.enabled !== false;
            const details: string[] = [];
            if ('format' in cfg && cfg.format) details.push(`format: "${cfg.format}"`);
            if ('drop' in cfg && cfg.drop === true) details.push('drop');
            const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
            out.print(`  ${transformName}: ${enabled ? 'enabled' : 'disabled'}${detailStr}`);
          }
        }

        // Collect transform warnings for Issues zone
        if (deviceTransformWarnings) {
          for (const warning of deviceTransformWarnings) {
            infoIssues.push({
              marker: '!',
              label: 'Transform',
              summary: warning.message,
              details: [],
            });
          }
        }
      }

      // ── Issues zone ───────────────────────────────────────────────
      if (infoIssues.length > 0) {
        out.newline();
        printIssues(out, infoIssues);
      }

      // Show tips based on sync tag state
      if (liveStatus?.musicCount !== undefined && liveStatus.musicCount > 0) {
        const syncTagCount = liveStatus.syncTagCount ?? 0;
        const missingArt = liveStatus.syncTagMissingArt ?? 0;
        out.printTips({
          syncTagInfo: {
            trackCount: liveStatus.musicCount,
            syncTagCount,
            missingArt,
          },
        });
      }
    }
  );

  if (databaseErrorIsUnexpected) {
    process.exitCode = 1;
  }
}
