/** Event sent to WebSocket clients */
export interface ServerEvent {
  type: 'plugged' | 'unplugged' | 'database-changed' | 'reset';
  [key: string]: unknown;
}

/** Response from the /status endpoint */
export interface StatusResponse {
  connected: boolean;
  mounted: boolean;
  mountPoint: string;
  trackCount: number;
}

/** Gadget lifecycle interface */
export interface GadgetController {
  plug(): Promise<void>;
  unplug(): Promise<void>;
  isPluggedIn(): boolean;
  isMounted(): boolean;
}

/** Configuration for the virtual iPod server */
export interface ServerConfig {
  port: number;
  imagePath: string;
  imageSizeMb: number;
  mountPoint: string;
  gadgetPath: string;
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: 3456,
  imagePath: '/var/lib/virtual-ipod/ipod.img',
  imageSizeMb: 2048,
  mountPoint: '/mnt/ipod',
  gadgetPath: '/sys/kernel/config/usb_gadget/virtual_ipod',
};
