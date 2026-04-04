import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GadgetController, UsbStatus } from './types.js';
import type { StorageRegistry } from './storage.js';

export interface UsbBusCallbacks {
  onBeforeUnmount?: (ipodId: string) => void;
  onAfterMount?: (ipodId: string) => void;
}

/**
 * Coordinates the USB bus — plugging and unplugging iPod storage
 * by managing the handoff between loop mounts (for serving) and
 * USB gadget block device mounts (for podkit access).
 */
export function createUsbBus(
  registry: StorageRegistry,
  gadget: GadgetController,
  storageRoot: string,
  gadgetMountPoint: string,
  callbacks: UsbBusCallbacks = {}
) {
  let currentIpodId: string | null = null;
  const stateFile = join(storageRoot, '.usb-state');

  // Restore state from disk
  try {
    if (existsSync(stateFile)) {
      currentIpodId = readFileSync(stateFile, 'utf-8').trim() || null;
    }
  } catch {
    // ignore
  }

  function persistState(): void {
    try {
      writeFileSync(stateFile, currentIpodId ?? '');
    } catch {
      // best effort
    }
  }

  async function plug(ipodId: string): Promise<void> {
    if (currentIpodId) {
      throw new Error(`iPod '${currentIpodId}' is already plugged in — unplug first`);
    }

    const storage = registry.get(ipodId);
    if (!storage) {
      throw new Error(`iPod storage '${ipodId}' does not exist`);
    }

    // Stop file watchers before unmounting to avoid "target is busy"
    callbacks.onBeforeUnmount?.(ipodId);
    // Brief pause for the kernel to release inotify file handles
    await new Promise((r) => setTimeout(r, 100));

    // Release the loop mount so the gadget gets exclusive access to the image
    await registry.unmount(ipodId);

    // Bind USB gadget and mount the block device at the public mount point
    // (where podkit discovers it). If this fails, re-mount the loop device.
    try {
      await gadget.plug(storage.imagePath, gadgetMountPoint);
    } catch (e) {
      console.warn('Gadget plug failed, re-mounting storage:', e instanceof Error ? e.message : e);
      try {
        await registry.mount(ipodId);
        callbacks.onAfterMount?.(ipodId);
      } catch {
        // double fault — storage is stuck unmounted
      }
      throw e;
    }

    currentIpodId = ipodId;
    persistState();
  }

  async function unplug(): Promise<void> {
    if (!currentIpodId) return;

    const ipodId = currentIpodId;

    // Unmount the block device and tear down the gadget
    await gadget.unplug(gadgetMountPoint);

    // Re-loop-mount so the server can serve files again
    try {
      await registry.mount(ipodId);
      callbacks.onAfterMount?.(ipodId);
    } catch (e) {
      console.warn(
        `Failed to re-mount iPod '${ipodId}' after unplug:`,
        e instanceof Error ? e.message : e
      );
    }

    currentIpodId = null;
    persistState();
  }

  function status(): UsbStatus {
    return {
      pluggedIn: currentIpodId !== null && gadget.isPluggedIn(),
      ipodId: currentIpodId,
    };
  }

  /**
   * Recover from stale gadget state on startup.
   * If the gadget reports plugged but we have no record, clean up.
   */
  async function recoverStaleState(): Promise<void> {
    if (!gadget.isPluggedIn()) {
      // Gadget not plugged — if we have a stale state file, clear it and ensure mounted
      if (currentIpodId) {
        const ipodId = currentIpodId;
        currentIpodId = null;
        persistState();
        // Ensure the storage is loop-mounted
        try {
          await registry.mount(ipodId);
        } catch {
          // may not exist anymore
        }
      }
      return;
    }

    // Gadget is plugged in
    if (currentIpodId) {
      // We know which iPod was plugged — state is consistent
      console.log(`USB gadget active with iPod '${currentIpodId}'`);
    } else {
      // Gadget plugged but we don't know which iPod — stale state, clean up
      console.warn('Stale gadget state on startup, cleaning up');
      try {
        // Use a dummy mount point for cleanup — the gadget will unmount whatever is there
        await gadget.unplug('/mnt/ipod');
      } catch {
        /* best effort */
      }
    }
  }

  return { plug, unplug, status, recoverStaleState };
}

export type UsbBus = ReturnType<typeof createUsbBus>;
