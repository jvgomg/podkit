/**
 * Apple iPod USB product ID lookup table
 *
 * Maps Apple USB product IDs (vendor 0x05ac) to human-readable model names.
 * Based on community-maintained USB ID databases and direct device testing.
 *
 * Note: Apple has not published an official product ID list. Entries are
 * sourced from the Linux USB ID repository, libimobiledevice, and community
 * reports. Where sources conflict, the most commonly cited mapping is used.
 */

const IPOD_MODELS: Record<string, string> = {
  // -------------------------------------------------------------------------
  // iPod Classic (hard disk / iFlash)
  // -------------------------------------------------------------------------
  '0x1207': 'iPod 5th generation (Video)',
  '0x1209': 'iPod Classic 6th generation',
  '0x120a': 'iPod Classic 7th generation',

  // -------------------------------------------------------------------------
  // iPod mini
  // -------------------------------------------------------------------------
  '0x1202': 'iPod mini 1st generation',
  '0x1204': 'iPod mini 2nd generation',

  // -------------------------------------------------------------------------
  // iPod nano
  // -------------------------------------------------------------------------
  '0x1205': 'iPod nano 1st generation',
  '0x1206': 'iPod nano 2nd generation',
  '0x1208': 'iPod nano 3rd generation',
  '0x120b': 'iPod nano 4th generation',
  '0x120c': 'iPod nano 5th generation',
  '0x120d': 'iPod nano 6th generation',
  '0x120e': 'iPod nano 7th generation',

  // -------------------------------------------------------------------------
  // iPod shuffle
  // -------------------------------------------------------------------------
  '0x1300': 'iPod shuffle 1st generation',
  '0x1301': 'iPod shuffle 2nd generation',
  '0x1302': 'iPod shuffle 3rd generation',
  '0x1303': 'iPod shuffle 4th generation',

  // -------------------------------------------------------------------------
  // iPod touch
  // -------------------------------------------------------------------------
  '0x1291': 'iPod touch 1st generation',
  '0x1292': 'iPod touch 2nd generation',
  '0x1293': 'iPod touch 3rd generation',
  '0x129a': 'iPod touch 4th generation',
  '0x12a0': 'iPod touch 5th generation',
  '0x12ab': 'iPod touch 6th generation',
  '0x12a8': 'iPod touch 7th generation',
};

/**
 * Look up a human-readable model name from an Apple USB product ID.
 *
 * @param productId - Hex product ID string, with or without leading zeros
 *                    (e.g., "0x1209", "0x1209")
 * @returns Model name if the ID is in the lookup table, undefined otherwise
 */
export function lookupIpodModel(productId: string): string | undefined {
  // Normalise to lowercase with 0x prefix for consistent lookup
  const normalised = productId.toLowerCase().startsWith('0x')
    ? productId.toLowerCase()
    : `0x${productId.toLowerCase()}`;

  return IPOD_MODELS[normalised];
}

/**
 * iPod SysInfo model number to human-readable name mapping.
 *
 * Maps `ModelNumStr` values found in `iPod_Control/Device/SysInfo` to
 * human-readable model descriptions. These are Apple internal model numbers
 * (e.g. "MA147"), distinct from USB product IDs used by `lookupIpodModel`.
 *
 * Sources: libgpod source, community databases, and direct device testing.
 */
const SYSINFO_MODEL_NAMES: Record<string, string> = {
  // -------------------------------------------------------------------------
  // iPod (1st–4th gen)
  // -------------------------------------------------------------------------
  M8513: 'iPod 5GB (1st generation)',
  M8737: 'iPod 10GB (2nd generation)',
  M8976: 'iPod 10GB (3rd generation)',
  M9282: 'iPod 20GB (4th generation)',

  // -------------------------------------------------------------------------
  // iPod Photo
  // -------------------------------------------------------------------------
  MA079: 'iPod Photo 20GB',
  MA127: 'iPod Photo 60GB',

  // -------------------------------------------------------------------------
  // iPod Video (5th gen)
  // -------------------------------------------------------------------------
  MA002: 'iPod Video 30GB (5th generation)',
  MA003: 'iPod Video 60GB (5th generation)',
  MA146: 'iPod Video 30GB (5th generation)',
  MA147: 'iPod Video 60GB (5th generation)',

  // -------------------------------------------------------------------------
  // iPod Video (5.5th gen)
  // -------------------------------------------------------------------------
  MA444: 'iPod Video 30GB (5.5th generation)',
  MA446: 'iPod Video 80GB (5.5th generation)',
  MA448: 'iPod Video 30GB (5.5th generation)',
  MA450: 'iPod Video 80GB (5.5th generation)',

  // -------------------------------------------------------------------------
  // iPod Classic (6th gen)
  // -------------------------------------------------------------------------
  MB029: 'iPod Classic 80GB (6th generation)',
  MB147: 'iPod Classic 160GB (6th generation)',
  MB565: 'iPod Classic 120GB (6th generation)',

  // -------------------------------------------------------------------------
  // iPod Classic (7th gen)
  // -------------------------------------------------------------------------
  MC293: 'iPod Classic 160GB (7th generation)',
  MC297: 'iPod Classic 160GB (7th generation)',
  MC477: 'iPod Classic 160GB (7th generation)',

  // -------------------------------------------------------------------------
  // iPod mini
  // -------------------------------------------------------------------------
  M9160: 'iPod mini 4GB (1st generation)',
  M9436: 'iPod mini 6GB (1st generation)',
  M9800: 'iPod mini 4GB (2nd generation)',
  M9802: 'iPod mini 6GB (2nd generation)',

  // -------------------------------------------------------------------------
  // iPod nano (1st–7th gen)
  // -------------------------------------------------------------------------
  MA004: 'iPod nano 1GB (1st generation)',
  MA005: 'iPod nano 2GB (1st generation)',
  MA099: 'iPod nano 1GB (1st generation)',
  MA107: 'iPod nano 4GB (1st generation)',
  MA099LL: 'iPod nano 1GB (1st generation)',
  MA477: 'iPod nano 2GB (2nd generation)',
  MA428: 'iPod nano 4GB (2nd generation)',
  MA489: 'iPod nano 8GB (2nd generation)',
  MB261: 'iPod nano 4GB (3rd generation)',
  MB257: 'iPod nano 8GB (3rd generation)',
  MB263: 'iPod nano 4GB (4th generation)',
  MB598: 'iPod nano 8GB (4th generation)',
  MC027: 'iPod nano 8GB (5th generation)',
  MC031: 'iPod nano 16GB (5th generation)',
  MC525: 'iPod nano 8GB (6th generation)',
  MD477: 'iPod nano 16GB (7th generation)',
};

/**
 * Look up a human-readable model name from an iPod SysInfo model number string.
 *
 * @param modelNumStr - The `ModelNumStr` value from `iPod_Control/Device/SysInfo`
 *                      (e.g., "MA147", "MC297")
 * @returns Model name if the model number is known, undefined otherwise
 */
export function lookupIpodModelByNumber(modelNumStr: string): string | undefined {
  return SYSINFO_MODEL_NAMES[modelNumStr.toUpperCase()];
}
