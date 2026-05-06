/**
 * Generation metadata table.
 *
 * Maps each IpodGenerationId to its display name, checksum type, and
 * device-class capability flags (ALAC, video, artwork resolution).
 *
 * This is the single authoritative source for generation-level metadata.
 * It is consumed by `getCapabilities()` to synthesise a `DeviceCapabilities`
 * record with no reliance on libgpod runtime data — the spec calls this
 * "table-driven authority for device class capability".
 *
 * Parity with the legacy `createIpodCapabilities(libgpodInfo)` adapter
 * is asserted in `capabilities.test.ts` for every generation that has a
 * libgpod equivalent. Generations that map to libgpod's `unknown` (nano 7G,
 * touch 5G–7G) are sourced exclusively from this table and have `supported: false`.
 *
 * @module
 */

import type { IpodGeneration, IpodGenerationId } from '../types.js';

export const GENERATIONS: Record<IpodGenerationId, IpodGeneration> = {
  classic_1g: {
    id: 'classic_1g',
    displayName: 'iPod (1st Generation)',
    checksumType: 'none',
    supported: true,
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 0,
  },
  classic_2g: {
    id: 'classic_2g',
    displayName: 'iPod (2nd Generation)',
    checksumType: 'none',
    supported: true,
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 0,
  },
  classic_3g: {
    id: 'classic_3g',
    displayName: 'iPod (3rd Generation)',
    checksumType: 'none',
    supported: true,
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 0,
  },
  classic_4g: {
    id: 'classic_4g',
    displayName: 'iPod (4th Generation)',
    checksumType: 'none',
    supported: true,
    supportsAlac: true,
    supportsVideo: false,
    artworkMaxResolution: 0,
  },
  photo: {
    id: 'photo',
    displayName: 'iPod Photo',
    checksumType: 'none',
    supported: true,
    supportsAlac: true,
    supportsVideo: false,
    // 220x176 colour screen; ArtworkDB stores 320x240 thumbnails
    artworkMaxResolution: 320,
  },
  video_5g: {
    id: 'video_5g',
    displayName: 'iPod Video (5th Generation)',
    checksumType: 'none',
    supported: true,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  video_5_5g: {
    id: 'video_5_5g',
    displayName: 'iPod Video (5.5th Generation)',
    checksumType: 'none',
    supported: true,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  classic_6g: {
    id: 'classic_6g',
    displayName: 'iPod Classic (6th Generation)',
    checksumType: 'hash58',
    supported: true,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  classic_7g: {
    id: 'classic_7g',
    displayName: 'iPod Classic (7th Generation)',
    checksumType: 'hash58',
    supported: true,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  mini_1g: {
    id: 'mini_1g',
    displayName: 'iPod mini (1st Generation)',
    checksumType: 'none',
    supported: true,
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 0,
  },
  mini_2g: {
    id: 'mini_2g',
    displayName: 'iPod mini (2nd Generation)',
    checksumType: 'none',
    supported: true,
    supportsAlac: true,
    supportsVideo: false,
    artworkMaxResolution: 0,
  },
  nano_1g: {
    id: 'nano_1g',
    displayName: 'iPod nano (1st Generation)',
    checksumType: 'none',
    supported: true,
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 176, // 176x132
  },
  nano_2g: {
    id: 'nano_2g',
    displayName: 'iPod nano (2nd Generation)',
    checksumType: 'none',
    supported: true,
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 176, // 176x132
  },
  nano_3g: {
    id: 'nano_3g',
    displayName: 'iPod nano (3rd Generation)',
    checksumType: 'hash58',
    supported: true,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320, // 320x240 widescreen
  },
  nano_4g: {
    id: 'nano_4g',
    displayName: 'iPod nano (4th Generation)',
    checksumType: 'hash58',
    supported: true,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 240, // 240x320 portrait
  },
  nano_5g: {
    id: 'nano_5g',
    displayName: 'iPod nano (5th Generation)',
    checksumType: 'hash72',
    supported: true,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 240, // 240x376
  },
  nano_6g: {
    id: 'nano_6g',
    displayName: 'iPod nano (6th Generation)',
    checksumType: 'hashAB',
    // libgpod has entries for nano_6 but cannot write its iTunesDB format.
    // Multi-touch nano with no video playback hardware.
    supported: false,
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 240, // 240x240
  },
  nano_7g: {
    id: 'nano_7g',
    displayName: 'iPod nano (7th Generation)',
    checksumType: 'hashAB',
    // Not in libgpod's ipod_info_table — libgpod cannot sync this device.
    // Hardware specs preserved here for diagnostics (ALAC + video capable).
    supported: false,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 240, // 240x432
  },
  shuffle_1g: {
    id: 'shuffle_1g',
    displayName: 'iPod shuffle (1st Generation)',
    checksumType: 'none',
    supported: true,
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 0,
  },
  shuffle_2g: {
    id: 'shuffle_2g',
    displayName: 'iPod shuffle (2nd Generation)',
    checksumType: 'none',
    supported: true,
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 0,
  },
  shuffle_3g: {
    id: 'shuffle_3g',
    displayName: 'iPod shuffle (3rd Generation)',
    checksumType: 'none',
    // libgpod has ipod_info_table entries but requires iTunes authentication.
    supported: false,
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 0,
  },
  shuffle_4g: {
    id: 'shuffle_4g',
    displayName: 'iPod shuffle (4th Generation)',
    checksumType: 'none',
    // libgpod has ipod_info_table entries but requires iTunes authentication.
    supported: false,
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 0,
  },
  touch_1g: {
    id: 'touch_1g',
    displayName: 'iPod touch (1st Generation)',
    checksumType: 'hash72',
    // libgpod has ipod_info_table entries (A623/A627/B376) but uses Apple's
    // proprietary sync protocol — cannot be accessed via disk mode.
    supported: false,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  touch_2g: {
    id: 'touch_2g',
    displayName: 'iPod touch (2nd Generation)',
    checksumType: 'hash72',
    // libgpod has ipod_info_table entries (B528/B531/B533/C086) but uses
    // Apple's proprietary sync protocol — cannot be accessed via disk mode.
    supported: false,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  touch_3g: {
    id: 'touch_3g',
    displayName: 'iPod touch (3rd Generation)',
    checksumType: 'hash72',
    // libgpod has ipod_info_table entries (C008/C011) but uses Apple's
    // proprietary sync protocol — cannot be accessed via disk mode.
    supported: false,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  touch_4g: {
    id: 'touch_4g',
    displayName: 'iPod touch (4th Generation)',
    checksumType: 'hashAB',
    // libgpod has ipod_info_table entries (C540/C544/C547) but uses Apple's
    // proprietary sync protocol — cannot be accessed via disk mode.
    supported: false,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  touch_5g: {
    id: 'touch_5g',
    displayName: 'iPod touch (5th Generation)',
    checksumType: 'none',
    // Not in libgpod's ipod_info_table. Also uses Apple's proprietary sync
    // protocol — cannot be accessed via disk mode.
    supported: false,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  touch_6g: {
    id: 'touch_6g',
    displayName: 'iPod touch (6th Generation)',
    checksumType: 'none',
    // Not in libgpod's ipod_info_table. Also uses Apple's proprietary sync
    // protocol — cannot be accessed via disk mode.
    supported: false,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  touch_7g: {
    id: 'touch_7g',
    displayName: 'iPod touch (7th Generation)',
    checksumType: 'none',
    // Not in libgpod's ipod_info_table. Also uses Apple's proprietary sync
    // protocol — cannot be accessed via disk mode.
    supported: false,
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
};
