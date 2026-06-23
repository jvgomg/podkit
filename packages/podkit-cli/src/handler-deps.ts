/**
 * Shared helpers for command-handler dependency injection.
 *
 * Per-handler `*Deps` interfaces extend `CoreLoaderDeps` to opt into the
 * `loadCore` seam — tests pass a stub that returns a fake `@podkit/core`
 * module, production calls the real dynamic import.
 *
 * The throw-style helper `loadCoreOrFail` centralises the boilerplate that
 * was previously duplicated at every CLI entry point. It is intentionally
 * NOT used by callers that return `{ error }` instead of throwing
 * (e.g. doctor.ts:resolveDevice) — those keep their inline try/catch.
 */

import type { IpodTrack } from '@podkit/core';
import { CliError } from './errors.js';
import type { OpenDeviceResult } from './commands/open-device.js';
import type { DeviceConfig, PodkitConfig } from './config/types.js';

/**
 * Mixed in by every handler `*Deps` interface. Production omits this field
 * and the default (real `import('@podkit/core')`) is used.
 */
export interface CoreLoaderDeps {
  loadCore?: () => Promise<typeof import('@podkit/core')>;
}

/**
 * Test-time shape of an open iPod adapter.
 *
 * Mirrors the `@podkit/core` `IpodDatabase` instance surface that handlers
 * call into (`getTracks`, `removeAllTracks`, etc) — but only the methods
 * the runners actually invoke. Tests provide a fake adapter via
 * `IpodDatabaseStub` so behaviour tests don't need a real iTunesDB fixture.
 *
 * NOTE: `DeviceAddDeps.ipodDatabase` uses a narrower inline shape for its
 * cascade-add flow. Keep that one intact — the broader shape here serves
 * the `clear` / `reset` / `init` / `reset-artwork` family.
 */
export interface IpodAdapterStub {
  trackCount: number;
  /** Mirrors `IpodDatabase.device` (a getter on the real class). */
  device: { modelName: string; modelNumber: string; generation: string; capacity: number };
  getTracks(): IpodTrack[];
  removeAllTracks(opts?: { deleteFiles?: boolean }): {
    removedCount: number;
    fileDeleteErrors: string[];
  };
  removeTracksByContentType(
    type: 'music' | 'video',
    opts?: { deleteFiles?: boolean }
  ): { removedCount: number; fileDeleteErrors: string[] };
  /** Mirrors `IpodDatabase.setDeviceName` — writes the master-playlist name. */
  setDeviceName(name: string): void;
  /**
   * Mirrors `IpodDatabase.getMasterPlaylist` — the master playlist's `name` is
   * the device's current display name, which `reset` reads to carry over.
   */
  getMasterPlaylist(): { name: string };
  save(): Promise<void>;
  close(): void;
}

/**
 * Test-time shape of the `IpodDatabase` static surface used by the
 * iPod-only operation runners (clear/reset/init/reset-artwork).
 */
export interface IpodDatabaseStub {
  open(path: string): Promise<IpodAdapterStub>;
  hasDatabase(path: string): Promise<boolean>;
  initializeIpod(path: string, opts?: { model?: string; name?: string }): Promise<IpodAdapterStub>;
}

/**
 * Override the high-level `openDevice` helper that branches on device type
 * (iPod vs mass-storage) and returns an opened adapter + capabilities.
 *
 * Used by handlers that read tracks from the device: `runDeviceInfo`,
 * `runDeviceMusic`, `runDeviceVideo`. Stubbing here avoids having to wire
 * `core.IpodDeviceAdapter`, `core.identifyCapabilities`, and
 * `resolveIpodModel` together in the test.
 */
export type OpenDeviceFn = (
  core: typeof import('@podkit/core'),
  path: string,
  deviceConfig?: DeviceConfig,
  deviceDefaults?: PodkitConfig['deviceDefaults']
) => Promise<OpenDeviceResult>;

/**
 * Resolve the `@podkit/core` module via `deps.loadCore` or the real dynamic
 * import, throwing a `CliError` with the supplied `code` on failure.
 *
 * The `printText` block matches the previous inline pattern: a one-line
 * user-facing error plus a verbose-only detail line.
 */
export async function loadCoreOrFail(
  deps: CoreLoaderDeps,
  code: string
): Promise<typeof import('@podkit/core')> {
  const loadCore = deps.loadCore ?? (() => import('@podkit/core'));
  try {
    return await loadCore();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
    throw new CliError({
      message,
      code,
      printText: (o) => {
        o.error('Failed to load podkit-core.');
        o.verbose1(`Details: ${message}`);
      },
    });
  }
}
