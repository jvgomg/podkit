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
