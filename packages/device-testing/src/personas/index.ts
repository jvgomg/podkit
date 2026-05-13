/**
 * Device persona registry.
 *
 * See `documents/persona-capture-playbook.md` for the capture workflow.
 * Entries are listed in chronological capture order so the registry mirrors
 * the order provenance docs were written — useful when scanning recent work.
 *
 * @module
 */

import type { DevicePersona } from './types.js';

import { ipodMini2gPink } from './ipod-mini-2g-pink/persona.js';
import { ipodNano3gBlack } from './ipod-nano-3g-black/persona.js';
import { ipodNano4gBlack } from './ipod-nano-4g-black/persona.js';
import { ipodNano2gGreen } from './ipod-nano-2g-green/persona.js';
import { ipodNano7gBlue } from './ipod-nano-7g-blue/persona.js';
import { ipodNano7gSpaceGray } from './ipod-nano-7g-space-gray/persona.js';
import { ipodVideo5gIflash1tb } from './ipod-video-5g-iflash-1tb/persona.js';
import { ipodTouch5gUnsupported } from './ipod-touch-5g-unsupported/persona.js';
import { echoMini } from './echo-mini/persona.js';
import { sonyNwzE384 } from './sony-nwz-e384/persona.js';
import { sonyNwA1000 } from './sony-nw-a1000/persona.js';
import { sonyNwA3000 } from './sony-nw-a3000/persona.js';
import { sonyNwA1200 } from './sony-nw-a1200/persona.js';
import { sonyNwHd5 } from './sony-nw-hd5/persona.js';

export type { DevicePersona } from './types.js';

export { ipodMini2gPink } from './ipod-mini-2g-pink/persona.js';
export { ipodNano3gBlack } from './ipod-nano-3g-black/persona.js';
export { ipodNano4gBlack } from './ipod-nano-4g-black/persona.js';
export { ipodNano2gGreen } from './ipod-nano-2g-green/persona.js';
export { ipodNano7gBlue } from './ipod-nano-7g-blue/persona.js';
export { ipodNano7gSpaceGray } from './ipod-nano-7g-space-gray/persona.js';
export { ipodVideo5gIflash1tb } from './ipod-video-5g-iflash-1tb/persona.js';
export { ipodTouch5gUnsupported } from './ipod-touch-5g-unsupported/persona.js';
export { echoMini } from './echo-mini/persona.js';
export { sonyNwzE384 } from './sony-nwz-e384/persona.js';
export { sonyNwA1000 } from './sony-nw-a1000/persona.js';
export { sonyNwA3000 } from './sony-nw-a3000/persona.js';
export { sonyNwA1200 } from './sony-nw-a1200/persona.js';
export { sonyNwHd5 } from './sony-nw-hd5/persona.js';

/** Registry of device personas, keyed by `DevicePersona.id`. */
export const personas = new Map<string, DevicePersona>([
  [ipodMini2gPink.id, ipodMini2gPink],
  [ipodNano3gBlack.id, ipodNano3gBlack],
  [ipodNano4gBlack.id, ipodNano4gBlack],
  [ipodNano2gGreen.id, ipodNano2gGreen],
  [ipodNano7gBlue.id, ipodNano7gBlue],
  [ipodNano7gSpaceGray.id, ipodNano7gSpaceGray],
  [ipodVideo5gIflash1tb.id, ipodVideo5gIflash1tb],
  [ipodTouch5gUnsupported.id, ipodTouch5gUnsupported],
  [echoMini.id, echoMini],
  [sonyNwzE384.id, sonyNwzE384],
  [sonyNwA1000.id, sonyNwA1000],
  [sonyNwA3000.id, sonyNwA3000],
  [sonyNwA1200.id, sonyNwA1200],
  [sonyNwHd5.id, sonyNwHd5],
]);
