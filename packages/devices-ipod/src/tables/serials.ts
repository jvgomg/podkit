/**
 * Serial suffix → model number mapping.
 *
 * Maps the last 3 characters of an iPod serial number to model numbers.
 * The model number (prepended with "M") is the SysInfo ModelNumStr.
 *
 * Source: libgpod itdb_device.c serial_to_model_mapping (lines 633-868)
 * for generations up to nano 6G / touch 4G. Entries after that are
 * crowd-sourced from real hardware testing (see below).
 *
 * Example: serial "5U8280FNYXX" -> suffix "YXX" -> model "B261" -> "MB261"
 *        -> "iPod nano 8GB Black (3rd Generation)"
 *
 * Note: Some suffixes map to the same model. Where libgpod had duplicate
 * suffix entries with different models, the last entry wins (matching C behavior).
 *
 * ── Adding new serial suffix mappings ──────────────────────────────────────
 *
 * For post-libgpod generations (nano 7G, touch 5G+), no public mapping table
 * exists. New entries are added from real hardware:
 *
 *   1. Read the serial number from SysInfoExtended (via SCSI or USB inquiry)
 *   2. Take the last 3 characters as the suffix
 *   3. Identify the model number from the physical device (back engraving,
 *      Settings > About, or Apple order number lookup)
 *   4. Add the mapping below with a comment noting the source device
 *
 * @module
 */

/** Maps 3-character serial suffix (uppercase) → model number (no prefix) */
export const SERIAL_TO_MODEL: Record<string, string> = {
  // iPod (1st Generation)
  LG6: '8541',
  NAM: '8541',
  MJ2: '8541',
  ML1: '8709',
  MME: '8709',

  // iPod (2nd Generation)
  MMB: '8737',
  MMC: '8738',
  NGE: '8740',
  NGH: '8740',
  MMF: '8741',

  // iPod (3rd Generation)
  NLW: '8946',
  NRH: '8976',
  QQF: '9460',
  PQ5: '9244',
  PNT: '9244',
  NLY: '8948',
  NM7: '8948',
  PNU: '9245',
  PS9: '9282',
  Q8U: '9282',

  // iPod (4th Generation)
  V9V: '9787',
  S2X: '9787',
  PQ7: '9268',

  // iPod Photo
  TDU: 'A079',
  TDS: 'A079',
  TM2: 'A127',
  SAZ: '9830',
  SB1: '9830',
  SAY: '9829',
  R5Q: '9585',
  R5R: '9586',
  R5T: '9586',

  // iPod mini (1st Generation)
  PFW: '9160',
  PRC: '9160',
  QKL: '9436',
  QKQ: '9436',
  QKK: '9435',
  QKP: '9435',
  QKJ: '9434',
  QKN: '9434',
  QKM: '9437',
  QKR: '9437',

  // iPod mini (2nd Generation)
  S41: '9800',
  S4C: '9800',
  S43: '9802',
  S45: '9804',
  S47: '9806',
  S4J: '9806',
  S42: '9801',
  S44: '9803',
  S48: '9807',

  // iPod shuffle (1st Generation)
  RS9: '9724',
  QGV: '9724',
  TSX: '9724',
  PFV: '9724',
  R80: '9724',
  RSA: '9725',
  TSY: '9725',
  C60: '9725',

  // iPod shuffle (2nd Generation)
  VTE: 'A546',
  VTF: 'A546',
  XQ5: 'A947',
  XQS: 'A947',
  XQV: 'A949',
  XQX: 'A949',
  XQY: 'A951',
  XR1: 'A953',
  '1ZH': 'B518',
  '8CQ': 'C167',
  // YX7 appears for both nano_1g (A949) and shuffle_2g (B228) in libgpod.
  // YX9 appears for shuffle_2g (B225). In C, last-wins = shuffle_2g entries.
  YX7: 'B228',
  YX9: 'B225',
  YXA: 'B233',
  YX6: 'B225',
  YX8: 'A951',

  // iPod nano (1st Generation)
  UNA: 'A350',
  UNB: 'A350',
  UPR: 'A352',
  UPS: 'A352',
  SZB: 'A004',
  SZV: 'A004',
  SZW: 'A004',
  SZC: 'A005',
  SZT: 'A005',
  TJT: 'A099',
  TJU: 'A099',
  TK2: 'A107',
  TK3: 'A107',

  // iPod nano (2nd Generation)
  VQ5: 'A477',
  VQ6: 'A477',
  V8T: 'A426',
  V8U: 'A426',
  V8W: 'A428',
  V8X: 'A428',
  VQH: 'A487',
  VQJ: 'A487',
  VQK: 'A489',
  VKL: 'A489',
  WL2: 'A725',
  WL3: 'A725',
  X9A: 'A726',
  X9B: 'A726',
  VQT: 'A497',
  VQU: 'A497',

  // iPod Video (5th Generation)
  SZ9: 'A002',
  WEC: 'A002',
  WED: 'A002',
  WEG: 'A002',
  WEH: 'A002',
  WEL: 'A002',
  TXK: 'A146',
  TXM: 'A146',
  // WEE appears for both video_5g (A146) and video_5_5g (A446) in libgpod.
  // In C, last-wins semantics apply, so A446 is correct.
  WEE: 'A446',
  WEF: 'A146',
  WEJ: 'A146',
  WEK: 'A146',
  SZA: 'A003',
  SZU: 'A003',
  TXL: 'A147',
  TXN: 'A147',

  // iPod Video (5.5th Generation)
  V9K: 'A444',
  V9L: 'A444',
  WU9: 'A444',
  VQM: 'A446',
  V9M: 'A446',
  V9N: 'A446',
  V9P: 'A448',
  V9Q: 'A448',
  V9R: 'A450',
  V9S: 'A450',
  V95: 'A450',
  V96: 'A450',
  WUC: 'A450',
  W9G: 'A664',

  // iPod Classic (6th Generation)
  Y5N: 'B029',
  YMV: 'B147',
  YMU: 'B145',
  YMX: 'B150',

  // iPod Classic (6th Generation, revised -- 120GB)
  '2C5': 'B562',
  '2C7': 'B565',

  // iPod Classic (7th Generation)
  '9ZS': 'C293',
  '9ZU': 'C297',

  // iPod nano (3rd Generation)
  Y0P: 'A978',
  Y0R: 'A980',
  YXR: 'B249',
  YXV: 'B257',
  YXT: 'B253',
  YXX: 'B261',

  // iPod nano (4th Generation)
  '37P': 'B663',
  '37Q': 'B666',
  '37H': 'B654',
  '1P1': 'B480',
  '37K': 'B657',
  '37L': 'B660',
  '2ME': 'B598',
  '3QS': 'B732',
  '3QT': 'B735',
  '3QU': 'B739',
  '3QW': 'B742',
  '3QX': 'B745',
  '3QY': 'B748',
  '3R0': 'B754',
  '3QZ': 'B751',
  '5B7': 'B903',
  '5B8': 'B905',
  '5B9': 'B907',
  '5BA': 'B909',
  '5BB': 'B911',
  '5BC': 'B913',
  '5BD': 'B915',
  '5BE': 'B917',
  '5BF': 'B918',

  // iPod nano (5th Generation)
  '71V': 'C027',
  '71Y': 'C031',
  '721': 'C034',
  '726': 'C037',
  '72A': 'C040',
  '72F': 'C046',
  '72K': 'C049',
  '72L': 'C050',
  '72Q': 'C060',
  '72R': 'C062',
  '72S': 'C064',
  '72X': 'C066',
  '734': 'C068',
  '738': 'C070',
  '739': 'C072',
  '73A': 'C074',
  '73B': 'C075',

  // iPod nano (6th Generation)
  CMN: 'C525',
  DVX: 'C688',
  DVY: 'C689',
  DW0: 'C690',
  DW1: 'C691',
  DW2: 'C692',
  DW3: 'C693',
  CMP: 'C526',
  DW4: 'C694',
  DW5: 'C695',
  DW6: 'C696',
  DW7: 'C697',
  DW8: 'C698',
  DW9: 'C699',

  // iPod shuffle (3rd Generation)
  A1S: 'C306',
  A78: 'C323',
  ALB: 'C381',
  ALD: 'C384',
  ALG: 'C387',
  '4NZ': 'B867',
  '891': 'C164',
  A1L: 'C303',
  A1U: 'C307',
  A7B: 'C328',
  A7D: 'C331',

  // iPod shuffle (4th Generation)
  CMJ: 'C584',
  CMK: 'C585',
  FDM: 'C749',
  FDN: 'C750',
  FDP: 'C751',

  // iPod touch (1st Generation)
  W4N: 'A623',
  W4T: 'A627',
  '0JW': 'B376',

  // iPod touch (2nd Generation)
  '201': 'B528',
  '203': 'B531',

  // iPod touch (3rd Generation)
  '75J': 'C086',
  '6K2': 'C008',
  '6K4': 'C011',

  // iPod touch (4th Generation)
  // Source: libgpod itdb_device.c serial_to_model_mapping (lines 869-871).
  CP7: 'C540',
  CP9: 'C544',
  CPC: 'C547',

  // ── Post-libgpod generations (crowd-sourced from real hardware) ──────────
  //
  // Entries below are NOT from libgpod. They are captured from real devices
  // and added one at a time. Confidence is noted per entry.

  // iPod nano (7th Generation)
  // Source: real hardware — serial DCYN72R8FJQ1, device is Space Gray.
  // Mapped to E971 (2013 Space Gray). Could be KN52 (2015 Space Gray) —
  // both are 16GB Space Gray nano 7G, identical capabilities.
  JQ1: 'E971',
};

// Duplicate-suffix handling: libgpod's C array has duplicate keys where "last wins".
// YX7 (shuffle_2g B228 vs nano_1g A949), YX9 (shuffle_2g B225), and WEE (video_5_5g A446
// vs video_5g A146) are resolved inline above using libgpod's last-wins ordering.
