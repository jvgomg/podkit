import { existsSync, mkdirSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createImage, initializeIpodStructure } from './image.js';
import { mountImage, unmountAndDetach, isMountPoint, findLoopDevices } from './mount.js';
import type { StorageInfo, ServerConfig } from './types.js';

interface LoopMount {
  loopDev: string;
}

/**
 * Manages iPod disk image storage independently of USB state.
 * Each iPod is a directory under `storageRoot/<id>/` containing `ipod.img`.
 * When mounted, the filesystem is loop-mounted at `mountRoot/<id>/`.
 */
export function createStorageRegistry(config: ServerConfig) {
  const { storageRoot, mountRoot, imageSizeMb } = config;
  const loopMounts = new Map<string, LoopMount>();

  mkdirSync(storageRoot, { recursive: true });
  mkdirSync(mountRoot, { recursive: true });

  function imagePath(id: string): string {
    return join(storageRoot, id, 'ipod.img');
  }

  function mountPointFor(id: string): string {
    return join(mountRoot, id);
  }

  function countTracks(mountPoint: string): number {
    const musicDir = join(mountPoint, 'iPod_Control/Music');
    if (!existsSync(musicDir)) return 0;

    let count = 0;
    try {
      const subdirs = readdirSync(musicDir, { withFileTypes: true });
      for (const subdir of subdirs) {
        if (subdir.isDirectory()) {
          const files = readdirSync(join(musicDir, subdir.name));
          count += files.length;
        }
      }
    } catch {
      // Music directory may not be readable
    }
    return count;
  }

  function getInfo(id: string): StorageInfo | null {
    const imgPath = imagePath(id);
    if (!existsSync(imgPath)) return null;
    const mp = mountPointFor(id);
    const mounted = isMountPoint(mp);
    return {
      id,
      imagePath: imgPath,
      mountPoint: mp,
      mounted,
      trackCount: mounted ? countTracks(mp) : 0,
    };
  }

  function list(): StorageInfo[] {
    if (!existsSync(storageRoot)) return [];
    const entries = readdirSync(storageRoot, { withFileTypes: true });
    const result: StorageInfo[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const info = getInfo(entry.name);
      if (info) result.push(info);
    }
    return result;
  }

  async function create(
    id: string = 'default',
    sizeMb: number = imageSizeMb
  ): Promise<StorageInfo> {
    const imgPath = imagePath(id);
    const mp = mountPointFor(id);

    createImage(imgPath, sizeMb);

    // Loop-mount and initialize iPod structure
    const loopDev = mountImage(imgPath, mp);
    loopMounts.set(id, { loopDev });
    initializeIpodStructure(mp);

    return getInfo(id)!;
  }

  async function wipe(id: string): Promise<void> {
    // Unmount if mounted
    if (loopMounts.has(id)) {
      await unmount(id);
    }

    // Remove the storage directory
    const storageDir = join(storageRoot, id);
    if (existsSync(storageDir)) {
      rmSync(storageDir, { recursive: true, force: true });
    }

    // Remove the mount point directory
    const mp = mountPointFor(id);
    if (existsSync(mp)) {
      rmSync(mp, { recursive: true, force: true });
    }
  }

  async function mount(id: string): Promise<void> {
    if (loopMounts.has(id)) return; // already mounted
    const imgPath = imagePath(id);
    if (!existsSync(imgPath)) {
      throw new Error(`iPod storage '${id}' does not exist`);
    }
    const mp = mountPointFor(id);
    const loopDev = mountImage(imgPath, mp);
    loopMounts.set(id, { loopDev });
  }

  async function unmount(id: string): Promise<void> {
    const entry = loopMounts.get(id);
    if (!entry) return; // not mounted
    const mp = mountPointFor(id);
    unmountAndDetach(mp, entry.loopDev);
    loopMounts.delete(id);
  }

  /**
   * Scan for existing storages on startup and loop-mount them.
   * Also handles migration from the old single-image layout.
   */
  async function initialize(): Promise<void> {
    // Migrate old layout: /var/lib/virtual-ipod/ipod.img → storages/default/ipod.img
    const oldImagePath = join(storageRoot, '..', 'ipod.img');
    const newDir = join(storageRoot, 'default');
    const newImagePath = imagePath('default');
    if (existsSync(oldImagePath) && !existsSync(newImagePath)) {
      mkdirSync(newDir, { recursive: true });
      renameSync(oldImagePath, newImagePath);
      console.log('Migrated iPod image to new storage layout');
    }

    // Scan and mount existing storages
    const storages = list();
    for (const storage of storages) {
      if (storage.mounted) {
        // Already mounted (e.g. survived a server restart) — recover the loop device
        // association so unmount() can properly detach it later.
        const devices = findLoopDevices(imagePath(storage.id));
        if (devices.length > 0) {
          loopMounts.set(storage.id, { loopDev: devices[0]! });
          console.log(`Recovered loop device ${devices[0]} for iPod storage '${storage.id}'`);
        }
      } else {
        try {
          await mount(storage.id);
          console.log(`Mounted iPod storage '${storage.id}'`);
        } catch (e) {
          console.warn(
            `Failed to mount iPod storage '${storage.id}':`,
            e instanceof Error ? e.message : e
          );
        }
      }
    }

    // Auto-create default if none exist
    if (list().length === 0) {
      await create('default');
      console.log('Created default iPod storage');
    }
  }

  return {
    list,
    get: getInfo,
    create,
    wipe,
    mount,
    unmount,
    initialize,
    mountPointFor,
    imagePath,
  };
}

export type StorageRegistry = ReturnType<typeof createStorageRegistry>;
