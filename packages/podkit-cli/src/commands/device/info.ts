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
  formatGeneration,
  validateDevice,
  DEFAULT_LOSSY_STACK,
  DEFAULT_LOSSLESS_STACK,
} from '@podkit/core';
import type { ReadinessLevel } from '@podkit/core';
import { openDevice, isMassStorageDevice, getDeviceTypeDisplayName } from '../open-device.js';
import { formatReadinessLevel, collectReadinessIssues, printIssues } from '../readiness-display.js';
import { DeviceErrorCodes } from './error-codes.js';
import {
  resolveDeviceArg,
  getStorageInfo,
  formatSyncTagSummary,
  synthesizePathModeDeviceInfo,
} from './shared.js';
import type { DeviceInfoOutput, DeviceInfoSuccess } from './output-types.js';
import { printCapabilitySummary } from './capability-summary.js';

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
              podkitConfig.deviceDefaults
            );
            resolvedDeviceCapabilities = openedDeviceResult.capabilities;
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

            // iPod-specific model and validation info
            if (openedDeviceResult.ipod) {
              const info = openedDeviceResult.ipod.getInfo();
              const deviceValidation = validateDevice(info.device, resolveResult.path);
              liveStatus.model = {
                name: info.device.modelName,
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

            // Mass-storage capabilities for JSON output
            if (!openedDeviceResult.ipod && resolvedDeviceCapabilities) {
              liveStatus.massStorageCapabilities = {
                supportedAudioCodecs: [...resolvedDeviceCapabilities.supportedAudioCodecs],
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
            // IpodError on iPod devices is expected (empty/uninitialized)
            if (err instanceof core.IpodError && !isMassStorageDevice(device?.type)) {
              // Database not found or corrupt — expected on empty/uninitialized iPods
            } else {
              databaseErrorIsUnexpected = true;
            }
          }

          // Look up filesystem UUID for the mount point. Single diskutil-info
          // call (cheap); avoids the full findIpodDevices walk below.
          if (liveStatus?.mounted && manager.isSupported) {
            try {
              const uuid = await manager.getUuidForMountPoint(resolveResult.path);
              if (uuid) {
                liveStatus.volumeUuid = uuid;
              }
            } catch {
              // Gracefully skip UUID display when extraction fails
            }
          }

          // Run readiness check for iPod devices (skip mass-storage). In path
          // mode we synthesize the PlatformDeviceInfo from data we already
          // have rather than calling manager.findIpodDevices() — that's a
          // full disk enumeration which on macOS dispatches diskutil
          // subprocesses per attached disk.
          if (liveStatus?.mounted && !isMassStorageDevice(device?.type) && manager.isSupported) {
            try {
              const matchingIpod =
                resolveResult.deviceInfo ??
                synthesizePathModeDeviceInfo(resolveResult.path, liveStatus.volumeUuid);
              const readiness = await core.checkReadiness({
                device: matchingIpod,
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

  out.result<DeviceInfoOutput>(
    {
      success: true,
      device: device
        ? {
            name: deviceName!,
            volumeUuid: device.volumeUuid,
            volumeName: device.volumeName,
            quality: device.quality,
            audioQuality: device.audioQuality,
            videoQuality: device.videoQuality,
            artwork: device.artwork,
            transforms: device.transforms as unknown as Record<string, unknown> | undefined,
            transformWarnings: deviceTransformWarnings,
            isDefault,
          }
        : undefined,
      status: liveStatus,
      readiness: readinessData,
    },
    () => {
      // Human-readable output — Summary zone then Issues zone
      const isMassStorage = device ? isMassStorageDevice(device.type) : false;
      const infoIssues: import('../readiness-display.js').ReadinessIssue[] = [];
      const cmdTarget = deviceName || cliPath || 'device';

      // ── Summary zone ──────────────────────────────────────────────
      if (device) {
        out.print(`Device: ${deviceName}${isDefault ? ' (default)' : ''}`);
        if (isMassStorage) {
          out.print(`  Type:          ${getDeviceTypeDisplayName(device.type)}`);
        }
        if (device.volumeUuid) {
          out.print(`  Volume UUID:   ${device.volumeUuid}`);
        }
        if (device.volumeName) {
          out.print(`  Volume Name:   ${device.volumeName}`);
        }
      } else if (cliPath) {
        out.print(`Device: ${cliPath} (path mode)`);
        if (liveStatus?.volumeUuid) {
          out.print(`  Volume UUID:   ${liveStatus.volumeUuid}`);
        }
      }

      if (liveStatus) {
        if (liveStatus.mounted && liveStatus.mountPoint) {
          out.print(`  Status:        Mounted at ${liveStatus.mountPoint}`);
        } else if (liveStatus.mounted === false) {
          out.print(`  Status:        Not mounted`);
        }

        // Model line — prefer IpodModel (has color) over database model
        if (!isMassStorage && readinessData?.model) {
          out.print(`  Model:         ${readinessData.model.displayName}`);
        } else if (!isMassStorage && liveStatus.model) {
          const capacityStr =
            liveStatus.model.capacity > 0 ? ` (${liveStatus.model.capacity}GB)` : '';
          const genStr = formatGeneration(liveStatus.model.generation);
          out.print(`  Model:         ${liveStatus.model.name}${capacityStr} - ${genStr}`);
        } else if (!isMassStorage && !liveStatus.model && liveStatus.mounted) {
          out.print('  Model:         Unknown \u2014 SysInfo missing');
        }

        // Readiness line — short status only
        if (!isMassStorage && readinessData) {
          const levelLabel =
            readinessData.level === 'ready'
              ? 'Ready'
              : formatReadinessLevel(readinessData.level as ReadinessLevel, cmdTarget);
          out.print(`  Readiness:     ${levelLabel}`);

          // Surface the canonical rejection reason inline so the user does
          // not have to dig into Issues for the most important detail.
          if (readinessData.level === 'unsupported' && readinessData.unsupported) {
            out.print(`  Reason:        ${readinessData.unsupported.headline}`);
            if (readinessData.unsupported.details) {
              for (const line of readinessData.unsupported.details) {
                out.print(`                 ${line}`);
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

        // Capabilities — compact, unified through the device-level helper.
        // Podcasts support comes from libgpod (legacy boolean shape) and is
        // not modelled in DeviceCapabilities, so we pass it through ctx.
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
            { indent: '  ' }
          );
        } else if (!isMassStorage && !liveStatus.model && liveStatus.mounted) {
          out.print('  Capabilities:  Music only (model unknown)');
        } else if (isMassStorage && resolvedDeviceCapabilities) {
          printCapabilitySummary(
            out,
            resolvedDeviceCapabilities,
            { kind: 'mass-storage' },
            { indent: '  ' }
          );
        }

        // Codec display
        if (resolvedDeviceCapabilities) {
          const deviceCodecs = new Set<string>(resolvedDeviceCapabilities.supportedAudioCodecs);
          const codecConfig = device?.codec ?? podkitConfig.codec;
          const lossyStack = codecConfig?.lossy ?? DEFAULT_LOSSY_STACK;
          const losslessStack = codecConfig?.lossless ?? DEFAULT_LOSSLESS_STACK;

          const allStacks = [...lossyStack, ...losslessStack];
          const seen = new Set<string>();
          const supportedCodecs = allStacks.filter((c) => {
            if (c === 'source' || seen.has(c)) return false;
            seen.add(c);
            return deviceCodecs.has(c);
          });

          out.print(`  Codecs:          ${supportedCodecs.join(', ') || 'none'}`);
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

      if (device) {
        out.print(`  Quality:       ${device.quality || '(not set)'}`);
        if (device.audioQuality) {
          out.print(`  Audio Quality: ${device.audioQuality}`);
        }
        if (device.videoQuality) {
          out.print(`  Video Quality: ${device.videoQuality}`);
        }
        out.print(
          `  Artwork:       ${device.artwork === true ? 'yes' : device.artwork === false ? 'no' : '(not set)'}`
        );

        if (device.transforms) {
          out.print('  Transforms:');
          for (const [transformName, transformConfig] of Object.entries(device.transforms)) {
            const cfg = transformConfig as Record<string, unknown>;
            const enabled = cfg.enabled !== false;
            const details: string[] = [];

            if ('format' in cfg && cfg.format) {
              details.push(`format: "${cfg.format}"`);
            }
            if ('drop' in cfg && cfg.drop === true) {
              details.push('drop');
            }

            const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
            out.print(`    ${transformName}: ${enabled ? 'enabled' : 'disabled'}${detailStr}`);
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

        // Show mass-storage-specific config overrides
        if (isMassStorage) {
          const overrides: string[] = [];
          if (device.artworkMaxResolution !== undefined) {
            overrides.push(`  Artwork Resolution: ${device.artworkMaxResolution}px (override)`);
          }
          if (device.artworkSources !== undefined) {
            overrides.push(`  Artwork Sources:    ${device.artworkSources.join(', ')} (override)`);
          }
          if (device.supportedAudioCodecs !== undefined) {
            overrides.push(
              `  Audio Codecs:       ${device.supportedAudioCodecs.join(', ')} (override)`
            );
          }
          if (device.supportsVideo !== undefined) {
            overrides.push(
              `  Video Support:      ${device.supportsVideo ? 'yes' : 'no'} (override)`
            );
          }
          if (device.audioNormalization !== undefined) {
            overrides.push(`  Normalization:      ${device.audioNormalization} (override)`);
          }
          if (device.supportsAlbumArtistBrowsing !== undefined) {
            overrides.push(
              `  Album Artist:       ${device.supportsAlbumArtistBrowsing ? 'yes' : 'no'} (override)`
            );
          }
          if (device.musicDir !== undefined) {
            overrides.push(`  Music Directory:    ${device.musicDir}`);
          }
          if (device.moviesDir !== undefined) {
            overrides.push(`  Movies Directory:   ${device.moviesDir}`);
          }
          if (device.tvShowsDir !== undefined) {
            overrides.push(`  TV Shows Directory: ${device.tvShowsDir}`);
          }
          if (overrides.length > 0) {
            for (const line of overrides) {
              out.print(line);
            }
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
