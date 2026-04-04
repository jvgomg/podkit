/** Event sent to WebSocket clients */
export interface ServerEvent {
  type: 'plugged' | 'unplugged' | 'database-changed' | 'storage-created' | 'storage-wiped';
  [key: string]: unknown;
}

/** Info about an iPod storage instance */
export interface StorageInfo {
  id: string;
  imagePath: string;
  mountPoint: string;
  mounted: boolean;
  trackCount: number;
}

/** USB bus status */
export interface UsbStatus {
  pluggedIn: boolean;
  ipodId: string | null;
}

/** Gadget lifecycle interface */
export interface GadgetController {
  plug(imagePath: string, mountPoint: string): Promise<void>;
  unplug(mountPoint: string): Promise<void>;
  isPluggedIn(): boolean;
}

/** Configuration for the virtual iPod server */
export interface ServerConfig {
  port: number;
  storageRoot: string;
  /** Private mount root for the server's loop mounts (serves ipod-web) */
  mountRoot: string;
  /** Public mount point where the USB gadget mounts for podkit to discover */
  gadgetMountPoint: string;
  imageSizeMb: number;
  gadgetPath: string;
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: 3456,
  storageRoot: '/var/lib/virtual-ipod/storages',
  mountRoot: '/srv/ipod-storage',
  gadgetMountPoint: '/mnt/ipod',
  imageSizeMb: 2048,
  gadgetPath: '/sys/kernel/config/usb_gadget/virtual_ipod',
};
