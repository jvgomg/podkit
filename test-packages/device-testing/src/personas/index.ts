/**
 * Device persona registry.
 *
 * See `documents/persona-capture-playbook.md` for the capture workflow.
 * Entries are listed in chronological capture order so the registry mirrors
 * the order provenance docs were written — useful when scanning recent work.
 *
 * Every entry passes through {@link validatePersona} and
 * {@link validateInitialContentExists} before being added to the map —
 * load-time surfacing of the mechanical constraints documented at
 * `documents/architecture/testing/vm-testing.md` §5. A persona that violates
 * the id/description/sourceFixture rules throws here rather than at the
 * EOVERFLOW/ENAMETOOLONG syscall inside the VM, which was historically the
 * symptom (see TASK-426 for context).
 *
 * @module
 */

import type { DevicePersona } from './types.js';
import { validatePersona } from './validator.js';

import { ipodMini2gPink } from './ipod-mini-2g-pink/persona.js';
import { ipodNano3gBlack } from './ipod-nano-3g-black/persona.js';
import { ipodNano4gBlack } from './ipod-nano-4g-black/persona.js';
import { ipodNano2gGreen } from './ipod-nano-2g-green/persona.js';
import { ipodNano7gBlue } from './ipod-nano-7g-blue/persona.js';
import { ipodNano7gSpaceGray } from './ipod-nano-7g-space-gray/persona.js';
import { ipodNano4gHfsplus } from './ipod-nano-4g-hfsplus/persona.js';
import { ipodVideo5gIflash1tb } from './ipod-video-5g-iflash-1tb/persona.js';
import { ipodTouch5gUnsupported } from './ipod-touch-5g-unsupported/persona.js';
import { echoMini } from './echo-mini/persona.js';
import { sonyNwzE384 } from './sony-nwz-e384/persona.js';
import { sonyNwA1000 } from './sony-nw-a1000/persona.js';
import { sonyNwA3000 } from './sony-nw-a3000/persona.js';
import { sonyNwA1200 } from './sony-nw-a1200/persona.js';
import { sonyNwHd5 } from './sony-nw-hd5/persona.js';
import { ipodShuffleNotSupported } from './ipod-shuffle-not-supported/persona.js';
import { nonIpodUsbDisk } from './non-ipod-usb-disk/persona.js';
import { malformedSysinfo } from './malformed-sysinfo/persona.js';
import { ipodVideo5gCorruptDb } from './ipod-video-5g-corrupt-db/persona.js';
import { echoMiniPopulated } from './echo-mini-populated/persona.js';
import { ipod5gModelnumMismatch } from './ipod-5g-modelnum-mismatch/persona.js';
import { ipod5gStaleGuid } from './ipod-5g-stale-guid/persona.js';

export type { DevicePersona } from './types.js';

export { ipodMini2gPink } from './ipod-mini-2g-pink/persona.js';
export { ipodNano3gBlack } from './ipod-nano-3g-black/persona.js';
export { ipodNano4gBlack } from './ipod-nano-4g-black/persona.js';
export { ipodNano2gGreen } from './ipod-nano-2g-green/persona.js';
export { ipodNano7gBlue } from './ipod-nano-7g-blue/persona.js';
export { ipodNano7gSpaceGray } from './ipod-nano-7g-space-gray/persona.js';
export { ipodNano4gHfsplus } from './ipod-nano-4g-hfsplus/persona.js';
export { ipodVideo5gIflash1tb } from './ipod-video-5g-iflash-1tb/persona.js';
export { ipodTouch5gUnsupported } from './ipod-touch-5g-unsupported/persona.js';
export { echoMini } from './echo-mini/persona.js';
export { sonyNwzE384 } from './sony-nwz-e384/persona.js';
export { sonyNwA1000 } from './sony-nw-a1000/persona.js';
export { sonyNwA3000 } from './sony-nw-a3000/persona.js';
export { sonyNwA1200 } from './sony-nw-a1200/persona.js';
export { sonyNwHd5 } from './sony-nw-hd5/persona.js';
export { ipodShuffleNotSupported } from './ipod-shuffle-not-supported/persona.js';
export { nonIpodUsbDisk } from './non-ipod-usb-disk/persona.js';
export { malformedSysinfo } from './malformed-sysinfo/persona.js';
export { ipodVideo5gCorruptDb, corruptItunesDb } from './ipod-video-5g-corrupt-db/persona.js';
export { echoMiniPopulated } from './echo-mini-populated/persona.js';
export { ipod5gModelnumMismatch } from './ipod-5g-modelnum-mismatch/persona.js';
export { ipod5gStaleGuid } from './ipod-5g-stale-guid/persona.js';

const ALL_PERSONAS: readonly DevicePersona[] = [
  ipodMini2gPink,
  ipodNano3gBlack,
  ipodNano4gBlack,
  ipodNano2gGreen,
  ipodNano7gBlue,
  ipodNano7gSpaceGray,
  ipodNano4gHfsplus,
  ipodVideo5gIflash1tb,
  ipodTouch5gUnsupported,
  echoMini,
  sonyNwzE384,
  sonyNwA1000,
  sonyNwA3000,
  sonyNwA1200,
  sonyNwHd5,
  // TASK-324 Phase 5 — synthesised rejection / error-path personas.
  ipodShuffleNotSupported,
  nonIpodUsbDisk,
  malformedSysinfo,
  // TASK-324 Phase 5 AC #1 — state-variant personas (synthesised).
  ipodVideo5gCorruptDb,
  echoMiniPopulated,
  ipod5gModelnumMismatch,
  ipod5gStaleGuid,
];

/**
 * Build the registry, validating each persona before insertion. Duplicate
 * ids fail loudly here instead of silently overwriting in `Map.set`.
 *
 * Only the pure `validatePersona` rules run at load time — the fs-side
 * `validateInitialContentExists` check is opt-in for callers that own a
 * persona-directory anchor (the harness preflight + unit tests). The
 * registry import path must remain fs-free to satisfy `no-fs-at-load`
 * (raw/ fixtures don't exist next to the bundled `dist/index.js`).
 */
function buildPersonaRegistry(entries: readonly DevicePersona[]): Map<string, DevicePersona> {
  const map = new Map<string, DevicePersona>();
  for (const persona of entries) {
    validatePersona(persona);
    if (map.has(persona.id)) {
      throw new Error(
        `Persona registry: duplicate id "${persona.id}". ` +
          `Each persona id must be unique — collisions silently overwrite.`
      );
    }
    map.set(persona.id, persona);
  }
  return map;
}

/** Registry of device personas, keyed by `DevicePersona.id`. */
export const personas: Map<string, DevicePersona> = buildPersonaRegistry(ALL_PERSONAS);
