/**
 * Device command — manage devices.
 *
 * Provides subcommands for device management and content operations.
 *
 * @example
 * ```bash
 * podkit device                       # list configured devices
 * podkit device scan                  # scan for connected iPods
 * podkit device add -d <name>         # detect and add iPod
 * podkit device remove -d <name>      # remove from config
 * podkit device info [-d name]        # config + live status
 * podkit device music [-d name]       # list music on device
 * podkit device video [-d name]       # list video on device
 * podkit device clear [-d name]       # clear all content
 * podkit device reset [-d name]       # reset database
 * podkit device eject [-d name]       # eject device
 * podkit device mount [-d name]       # mount device
 * podkit device init [-d name]        # initialize iPod database
 * ```
 */
import { Command } from 'commander';
import { scanSubcommand } from './scan.js';
import { listSubcommand } from './list.js';
import { addSubcommand } from './add.js';
import { removeSubcommand } from './remove.js';
import { infoSubcommand } from './info.js';
import { musicSubcommand } from './music.js';
import { videoSubcommand } from './video.js';
import { clearSubcommand } from './clear.js';
import { resetSubcommand } from './reset.js';
import { resetArtworkSubcommand } from './reset-artwork.js';
import { ejectSubcommand } from './eject.js';
import { mountSubcommand } from './mount.js';
import { initSubcommand } from './init.js';
import { setSubcommand } from './set.js';
import { defaultSubcommand } from './default.js';

export const deviceCommand = new Command('device')
  .description('manage devices')
  .addCommand(scanSubcommand)
  .addCommand(listSubcommand)
  .addCommand(addSubcommand)
  .addCommand(removeSubcommand)
  .addCommand(setSubcommand)
  .addCommand(defaultSubcommand)
  .addCommand(infoSubcommand)
  .addCommand(musicSubcommand)
  .addCommand(videoSubcommand)
  .addCommand(clearSubcommand)
  .addCommand(resetSubcommand)
  .addCommand(resetArtworkSubcommand)
  .addCommand(ejectSubcommand)
  .addCommand(mountSubcommand)
  .addCommand(initSubcommand)
  .action(async () => {
    // Default action: run list subcommand
    await listSubcommand.parseAsync([], { from: 'user' });
  });

// Re-export everything subcommand callers / tests expect to import from
// this module (and historically imported from `./device.js`).
export * from './error-codes.js';
export * from './output-types.js';
export * from './shared.js';
export { runDeviceScan, type DeviceScanDeps } from './scan.js';
export { runDeviceList, type DeviceListDeps } from './list.js';
export { runDeviceAdd, type DeviceAddDeps } from './add.js';
export { runDeviceInfo, type DeviceInfoDeps } from './info.js';
export { runDeviceMusic, type DeviceMusicDeps } from './music.js';
export { runDeviceVideo, type DeviceVideoDeps } from './video.js';
export { runDeviceClear } from './clear.js';
export { runDeviceReset } from './reset.js';
export { runDeviceResetArtwork } from './reset-artwork.js';
export { runDeviceEject, type DeviceEjectDeps } from './eject.js';
export { runDeviceMount, type DeviceMountDeps } from './mount.js';
export { runDeviceInit } from './init.js';
