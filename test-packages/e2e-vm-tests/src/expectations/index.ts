/**
 * Expectation registry — keyed by persona id, mirrors the personas registry
 * in `@podkit/device-testing`.
 *
 * Schema v3 lifted `expectedCapabilities`, `expectedReadiness`, and
 * `expectedDoctorOutput` out of `DevicePersona`. Expectations now live in
 * per-persona modules under this directory; the registry below provides a
 * single entry point keyed by `DevicePersona.id`.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"Schema v3 — May 2026"
 * @module
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { ReadinessResult } from '@podkit/core';

import * as echoMiniExpectations from './echo-mini.js';
import * as echoMiniPopulatedExpectations from './echo-mini-populated.js';
import * as ipodMini2gPinkExpectations from './ipod-mini-2g-pink.js';
import * as ipodNano2gGreenExpectations from './ipod-nano-2g-green.js';
import * as ipodNano3gBlackExpectations from './ipod-nano-3g-black.js';
import * as ipodNano4gBlackExpectations from './ipod-nano-4g-black.js';
import * as ipodNano7gBlueExpectations from './ipod-nano-7g-blue.js';
import * as ipodNano7gSpaceGrayExpectations from './ipod-nano-7g-space-gray.js';
import * as ipodShuffleNotSupportedExpectations from './ipod-shuffle-not-supported.js';
import * as ipodTouch5gUnsupportedExpectations from './ipod-touch-5g-unsupported.js';
import * as ipodVideo5gCorruptDbExpectations from './ipod-video-5g-corrupt-db.js';
import * as ipodVideo5gIflash1tbExpectations from './ipod-video-5g-iflash-1tb.js';
import * as malformedSysinfoExpectations from './malformed-sysinfo.js';
import * as nonIpodUsbDiskExpectations from './non-ipod-usb-disk.js';
import * as sonyNwA1000Expectations from './sony-nw-a1000.js';
import * as sonyNwA1200Expectations from './sony-nw-a1200.js';
import * as sonyNwA3000Expectations from './sony-nw-a3000.js';
import * as sonyNwHd5Expectations from './sony-nw-hd5.js';
import * as sonyNwzE384Expectations from './sony-nwz-e384.js';

export interface PersonaExpectations {
  expectedCapabilities: DeviceCapabilities | null;
  expectedReadiness: ReadinessResult;
  expectedDoctorOutput: unknown;
}

/** Registry of persona expectations, keyed by `DevicePersona.id`. */
export const expectations: ReadonlyMap<string, PersonaExpectations> = new Map<
  string,
  PersonaExpectations
>([
  ['echo-mini', echoMiniExpectations],
  ['echo-mini-populated', echoMiniPopulatedExpectations],
  ['ipod-mini-2g-pink', ipodMini2gPinkExpectations],
  ['ipod-nano-2g-green', ipodNano2gGreenExpectations],
  ['ipod-nano-3g-black', ipodNano3gBlackExpectations],
  ['ipod-nano-4g-black', ipodNano4gBlackExpectations],
  ['ipod-nano-7g-blue', ipodNano7gBlueExpectations],
  ['ipod-nano-7g-space-gray', ipodNano7gSpaceGrayExpectations],
  ['ipod-shuffle-not-supported', ipodShuffleNotSupportedExpectations],
  ['ipod-touch-5g-unsupported', ipodTouch5gUnsupportedExpectations],
  ['ipod-video-5g-corrupt-db', ipodVideo5gCorruptDbExpectations],
  ['ipod-video-5g-iflash-1tb', ipodVideo5gIflash1tbExpectations],
  ['malformed-sysinfo', malformedSysinfoExpectations],
  ['non-ipod-usb-disk', nonIpodUsbDiskExpectations],
  ['sony-nw-a1000', sonyNwA1000Expectations],
  ['sony-nw-a1200', sonyNwA1200Expectations],
  ['sony-nw-a3000', sonyNwA3000Expectations],
  ['sony-nw-hd5', sonyNwHd5Expectations],
  ['sony-nwz-e384', sonyNwzE384Expectations],
]);
