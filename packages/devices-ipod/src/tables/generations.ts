/**
 * Generation metadata table.
 *
 * Maps each IpodGenerationId to its family + ordinal pair (the structured
 * identity per ADR-020), checksum type, and device-class capability flags
 * (ALAC, video, artwork resolution).
 *
 * This is the single authoritative source for generation-level metadata.
 * It is consumed by `getCapabilities()` to synthesise a `DeviceCapabilities`
 * record with no reliance on libgpod runtime data — the spec calls this
 * "table-driven authority for device class capability".
 *
 * Parity with the legacy `createIpodCapabilities(libgpodInfo)` adapter
 * is asserted in `capabilities.test.ts` for every generation that has a
 * libgpod equivalent. Generations that map to libgpod's `unknown` (nano 7G,
 * touch 5G–7G) are sourced exclusively from this table for capability data.
 * Their `support.access` differs by generation: nano 7G is `read-only`
 * (hardware-confirmed readable; hashAB signing unavailable), touch 5G–7G
 * carry `support.access: 'none'` (no disk mode at all).
 *
 * @module
 */

import type { IpodGeneration, IpodGenerationId } from '../types.js';

export const GENERATIONS: Record<IpodGenerationId, IpodGeneration> = {
  classic_1g: {
    id: 'classic_1g',
    family: 'iPod',
    ordinal: 1,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: null,
  },
  classic_2g: {
    id: 'classic_2g',
    family: 'iPod',
    ordinal: 2,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: null,
  },
  classic_3g: {
    id: 'classic_3g',
    family: 'iPod',
    ordinal: 3,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: null,
  },
  classic_4g: {
    id: 'classic_4g',
    family: 'iPod',
    ordinal: 4,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: false,
    artworkMaxResolution: null,
  },
  photo: {
    id: 'photo',
    family: 'iPod Photo',
    ordinal: null,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: false,
    // 220x176 colour screen; ArtworkDB stores 320x240 thumbnails
    artworkMaxResolution: 320,
  },
  video_5g: {
    id: 'video_5g',
    family: 'iPod Video',
    ordinal: 5,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  video_5_5g: {
    id: 'video_5_5g',
    family: 'iPod Video',
    ordinal: 5.5,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  classic_6g: {
    id: 'classic_6g',
    family: 'iPod Classic',
    ordinal: 6,
    checksumType: 'hash58',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  classic_7g: {
    id: 'classic_7g',
    family: 'iPod Classic',
    ordinal: 7,
    checksumType: 'hash58',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  mini_1g: {
    id: 'mini_1g',
    family: 'iPod mini',
    ordinal: 1,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: null,
  },
  mini_2g: {
    id: 'mini_2g',
    family: 'iPod mini',
    ordinal: 2,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: false,
    artworkMaxResolution: null,
  },
  nano_1g: {
    id: 'nano_1g',
    family: 'iPod nano',
    ordinal: 1,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 176, // 176x132
  },
  nano_2g: {
    id: 'nano_2g',
    family: 'iPod nano',
    ordinal: 2,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 176, // 176x132
  },
  nano_3g: {
    id: 'nano_3g',
    family: 'iPod nano',
    ordinal: 3,
    checksumType: 'hash58',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320, // 320x240 widescreen
  },
  nano_4g: {
    id: 'nano_4g',
    family: 'iPod nano',
    ordinal: 4,
    checksumType: 'hash58',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 240, // 240x320 portrait
  },
  nano_5g: {
    id: 'nano_5g',
    family: 'iPod nano',
    ordinal: 5,
    checksumType: 'hash72',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 240, // 240x376
  },
  nano_6g: {
    id: 'nano_6g',
    family: 'iPod nano',
    ordinal: 6,
    checksumType: 'hashAB',
    // Multi-touch nano with no video playback hardware. Write is a format
    // libgpod cannot produce. Read is confirmed on hardware: a 16GB nano 6G
    // (serial DCYGLUGVDDW4) listed and archived 259 tracks cleanly.
    support: {
      access: 'read-only',
      verified: 'hardware',
      note: 'Reads and archives (259 tracks confirmed on hardware); writing needs an iTunesDB format libgpod cannot produce.',
    },
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: 240, // 240x240
  },
  nano_7g: {
    id: 'nano_7g',
    family: 'iPod nano',
    ordinal: 7,
    checksumType: 'hashAB',
    // Hardware-confirmed readable: podkit read 1,414 tracks off a real
    // nano 7G (serial DCYN83SFF0GQ) via libgpod's classic iTunesCDB parser,
    // and `device archive` succeeded. The write refusal is hashAB signing —
    // libgpod only computes it via an external `hashab` blob loaded through
    // `LIBGPOD_BLOB_DIR` (itdb_hashAB.c:43-68) and fails closed without it;
    // podkit ships no such blob. Not a libgpod-table gap, as previously
    // claimed here.
    support: {
      access: 'read-only',
      verified: 'hardware',
      note: 'Reads iTunesDB (1,414 tracks confirmed) and archives cleanly; writing needs the hashAB signature libgpod cannot produce without an external blob podkit does not ship.',
    },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 240, // 240x432
  },
  shuffle_1g: {
    id: 'shuffle_1g',
    family: 'iPod shuffle',
    ordinal: 1,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: null,
  },
  shuffle_2g: {
    id: 'shuffle_2g',
    family: 'iPod shuffle',
    ordinal: 2,
    checksumType: 'none',
    support: { access: 'syncable', verified: 'inferred' },
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: null,
  },
  shuffle_3g: {
    id: 'shuffle_3g',
    family: 'iPod shuffle',
    ordinal: 3,
    checksumType: 'none',
    // Hardware-probed: serial 4H02918LALD, FamilyID 132 (serial suffix ALD →
    // C384 agrees on generation). Same unverified iTunesSD write path as the 4g.
    support: {
      access: 'read-only',
      verified: 'hardware',
      note: 'Reads iTunesDB; writing the bdhs iTunesSD playback DB is unverified on hardware.',
    },
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: null,
  },
  shuffle_4g: {
    id: 'shuffle_4g',
    family: 'iPod shuffle',
    ordinal: 4,
    checksumType: 'none',
    // Confirmed on hardware: readable iTunesDB alongside the iTunesSD the
    // firmware plays from. libgpod does emit the bdhs iTunesSD these
    // generations use (no signing or checksum is involved — see
    // documents/formats/itunessd-bdhs.md), but that write has never been shown
    // to produce a playable 3g/4g, so the tier stays read-only until it is.
    support: {
      access: 'read-only',
      verified: 'hardware',
      note: 'Reads iTunesDB; writing the bdhs iTunesSD playback DB is unverified on hardware.',
    },
    supportsAlac: false,
    supportsVideo: false,
    artworkMaxResolution: null,
  },
  touch_1g: {
    id: 'touch_1g',
    family: 'iPod touch',
    ordinal: 1,
    checksumType: 'hash72',
    // libgpod has ipod_info_table entries (A623/A627/B376) but uses Apple's
    // proprietary sync protocol — cannot be accessed via disk mode.
    support: { access: 'none', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  touch_2g: {
    id: 'touch_2g',
    family: 'iPod touch',
    ordinal: 2,
    checksumType: 'hash72',
    // libgpod has ipod_info_table entries (B528/B531/B533/C086) but uses
    // Apple's proprietary sync protocol — cannot be accessed via disk mode.
    support: { access: 'none', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  touch_3g: {
    id: 'touch_3g',
    family: 'iPod touch',
    ordinal: 3,
    checksumType: 'hash72',
    // libgpod has ipod_info_table entries (C008/C011) but uses Apple's
    // proprietary sync protocol — cannot be accessed via disk mode.
    support: { access: 'none', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  touch_4g: {
    id: 'touch_4g',
    family: 'iPod touch',
    ordinal: 4,
    checksumType: 'hashAB',
    // libgpod has ipod_info_table entries (C540/C544/C547) but uses Apple's
    // proprietary sync protocol — cannot be accessed via disk mode.
    support: { access: 'none', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  touch_5g: {
    id: 'touch_5g',
    family: 'iPod touch',
    ordinal: 5,
    checksumType: 'none',
    // Not in libgpod's ipod_info_table. Also uses Apple's proprietary sync
    // protocol — cannot be accessed via disk mode.
    support: { access: 'none', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  touch_6g: {
    id: 'touch_6g',
    family: 'iPod touch',
    ordinal: 6,
    checksumType: 'none',
    // Not in libgpod's ipod_info_table. Also uses Apple's proprietary sync
    // protocol — cannot be accessed via disk mode.
    support: { access: 'none', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
  touch_7g: {
    id: 'touch_7g',
    family: 'iPod touch',
    ordinal: 7,
    checksumType: 'none',
    // Not in libgpod's ipod_info_table. Also uses Apple's proprietary sync
    // protocol — cannot be accessed via disk mode.
    support: { access: 'none', verified: 'inferred' },
    supportsAlac: true,
    supportsVideo: true,
    artworkMaxResolution: 320,
  },
};
