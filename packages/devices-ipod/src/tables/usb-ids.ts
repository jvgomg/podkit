/**
 * USB product ID → IpodGenerationId table.
 *
 * Maps Apple USB product IDs (vendor 0x05ac) to generation identifiers
 * and display names.
 *
 * Two ID ranges exist for many models:
 * - 0x120x range: original community-catalogued IDs (USB ID repository, libimobiledevice)
 * - 0x126x range: confirmed by linux-usb.org and real hardware testing; appears on
 *   devices in disk mode or with newer firmware revisions.
 *
 * Both ranges map to the same generations. DFU/WTF mode IDs (0x1223, 0x1224, etc.)
 * are intentionally excluded -- those are recovery-mode endpoints, not disk-mode devices.
 *
 * Note: 0x1266 (nano 6g via 0x126x range) should be added to UNSUPPORTED_IPODS
 * in usb-discovery.ts (parallel task 279.02 is editing that file).
 *
 * @module
 */

import type { IpodGenerationId } from '../types.js';

export interface UsbProductIdEntry {
  generation: IpodGenerationId;
  displayName: string;
}

export const IPOD_USB_IDS: Record<string, UsbProductIdEntry> = {
  // ── iPod Classic (hard disk / iFlash) ───────────────────────────────────
  '0x1207': { generation: 'video_5g', displayName: 'iPod 5th generation (Video)' },
  '0x1209': { generation: 'video_5g', displayName: 'iPod 5th generation (Video)' },

  // ── iPod mini ───────────────────────────────────────────────────────────
  // 0x1205 covers both mini 1G and 2G per linux-usb.org — mapped to mini_1g as
  // the two are functionally identical for podkit (same capabilities, checksumType: none).
  // Distinguish via SysInfo ModelNumStr or SCSI inquiry when precision is needed.
  '0x1202': { generation: 'mini_1g', displayName: 'iPod mini 1st generation' },
  '0x1204': { generation: 'mini_2g', displayName: 'iPod mini 2nd generation' },
  '0x1205': { generation: 'mini_1g', displayName: 'iPod mini' },

  // ── iPod nano (0x120x range) ────────────────────────────────────────────
  '0x120a': { generation: 'nano_1g', displayName: 'iPod nano 1st generation' },
  '0x1206': { generation: 'nano_2g', displayName: 'iPod nano 2nd generation' },
  '0x1208': { generation: 'nano_3g', displayName: 'iPod nano 3rd generation' },
  '0x120b': { generation: 'nano_4g', displayName: 'iPod nano 4th generation' },
  '0x120c': { generation: 'nano_5g', displayName: 'iPod nano 5th generation' },
  '0x120d': { generation: 'nano_6g', displayName: 'iPod nano 6th generation' },
  '0x120e': { generation: 'nano_7g', displayName: 'iPod nano 7th generation' },

  // ── iPod nano (0x126x range) ────────────────────────────────────────────
  // Source: linux-usb.org usb.ids + real hardware testing.
  // These appear on devices in disk mode or with newer firmware revisions.
  '0x1260': { generation: 'nano_2g', displayName: 'iPod nano 2nd generation' },
  '0x1261': { generation: 'classic_6g', displayName: 'iPod Classic 6th generation' },
  '0x1262': { generation: 'nano_3g', displayName: 'iPod nano 3rd generation' }, // confirmed on real iPod Nano 3G
  '0x1263': { generation: 'nano_4g', displayName: 'iPod nano 4th generation' },
  '0x1265': { generation: 'nano_5g', displayName: 'iPod nano 5th generation' },
  '0x1266': { generation: 'nano_6g', displayName: 'iPod nano 6th generation' },
  '0x1267': { generation: 'nano_7g', displayName: 'iPod nano 7th generation' },

  // ── iPod shuffle ────────────────────────────────────────────────────────
  '0x1300': { generation: 'shuffle_1g', displayName: 'iPod shuffle 1st generation' },
  '0x1301': { generation: 'shuffle_2g', displayName: 'iPod shuffle 2nd generation' },
  '0x1302': { generation: 'shuffle_3g', displayName: 'iPod shuffle 3rd generation' },
  '0x1303': { generation: 'shuffle_4g', displayName: 'iPod shuffle 4th generation' },

  // ── iPod touch ──────────────────────────────────────────────────────────
  '0x1291': { generation: 'touch_1g', displayName: 'iPod touch 1st generation' },
  '0x1292': { generation: 'touch_2g', displayName: 'iPod touch 2nd generation' },
  '0x1293': { generation: 'touch_3g', displayName: 'iPod touch 3rd generation' },
  '0x129a': { generation: 'touch_4g', displayName: 'iPod touch 4th generation' },
  '0x12a0': { generation: 'touch_5g', displayName: 'iPod touch 5th generation' },
  '0x12ab': { generation: 'touch_6g', displayName: 'iPod touch 6th generation' },
  '0x12a8': { generation: 'touch_7g', displayName: 'iPod touch 7th generation' },
};
