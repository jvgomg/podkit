/**
 * iPod model table and capability queries.
 *
 * The model table is ported from the `ipod_info_table` in libgpod's
 * `itdb_device.c` (libgpod 0.8.3). Each entry maps a SysInfo ModelNumStr
 * (without its leading "M") to device capabilities.
 *
 * The SysInfo file stores model numbers like "MA147"; libgpod strips the
 * leading "M" internally, giving "A147". This module follows the same
 * convention: `modelNumber` is the stripped form and `fullModelNumber`
 * adds "M" back.
 */

import type { IpodGeneration, IpodModel, IpodModelInfo } from './types.js';

export type { IpodGeneration, IpodModel, IpodModelInfo };

// ---------------------------------------------------------------------------
// Internal table definition
// ---------------------------------------------------------------------------

interface TableEntry {
  modelNumber: string;
  capacityGb: number;
  model: IpodModel;
  generation: IpodGeneration;
  displayName: string;
  musicDirs: number;
}

const MODEL_TABLE: TableEntry[] = [
  // First Generation
  {
    modelNumber: '8513',
    capacityGb: 5,
    model: 'regular',
    generation: 'first',
    displayName: 'iPod 5GB (1st Generation)',
    musicDirs: 20,
  },
  {
    modelNumber: '8541',
    capacityGb: 5,
    model: 'regular',
    generation: 'first',
    displayName: 'iPod 5GB (1st Generation)',
    musicDirs: 20,
  },
  {
    modelNumber: '8697',
    capacityGb: 5,
    model: 'regular',
    generation: 'first',
    displayName: 'iPod 5GB (1st Generation)',
    musicDirs: 20,
  },
  {
    modelNumber: '8709',
    capacityGb: 10,
    model: 'regular',
    generation: 'first',
    displayName: 'iPod 10GB (1st Generation)',
    musicDirs: 20,
  },

  // Second Generation
  {
    modelNumber: '8737',
    capacityGb: 10,
    model: 'regular',
    generation: 'second',
    displayName: 'iPod 10GB (2nd Generation)',
    musicDirs: 20,
  },
  {
    modelNumber: '8740',
    capacityGb: 10,
    model: 'regular',
    generation: 'second',
    displayName: 'iPod 10GB (2nd Generation)',
    musicDirs: 20,
  },
  {
    modelNumber: '8738',
    capacityGb: 20,
    model: 'regular',
    generation: 'second',
    displayName: 'iPod 20GB (2nd Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: '8741',
    capacityGb: 20,
    model: 'regular',
    generation: 'second',
    displayName: 'iPod 20GB (2nd Generation)',
    musicDirs: 50,
  },

  // Third Generation
  {
    modelNumber: '8976',
    capacityGb: 10,
    model: 'regular',
    generation: 'third',
    displayName: 'iPod 10GB (3rd Generation)',
    musicDirs: 20,
  },
  {
    modelNumber: '8946',
    capacityGb: 15,
    model: 'regular',
    generation: 'third',
    displayName: 'iPod 15GB (3rd Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: '9460',
    capacityGb: 15,
    model: 'regular',
    generation: 'third',
    displayName: 'iPod 15GB (3rd Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: '9244',
    capacityGb: 20,
    model: 'regular',
    generation: 'third',
    displayName: 'iPod 20GB (3rd Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: '8948',
    capacityGb: 30,
    model: 'regular',
    generation: 'third',
    displayName: 'iPod 30GB (3rd Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: '9245',
    capacityGb: 40,
    model: 'regular',
    generation: 'third',
    displayName: 'iPod 40GB (3rd Generation)',
    musicDirs: 50,
  },

  // Fourth Generation
  {
    modelNumber: '9282',
    capacityGb: 20,
    model: 'regular',
    generation: 'fourth',
    displayName: 'iPod 20GB (4th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: '9787',
    capacityGb: 25,
    model: 'regular_u2',
    generation: 'fourth',
    displayName: 'iPod U2 25GB (4th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: '9268',
    capacityGb: 40,
    model: 'regular',
    generation: 'fourth',
    displayName: 'iPod 40GB (4th Generation)',
    musicDirs: 50,
  },

  // Mini 1st Generation
  {
    modelNumber: '9160',
    capacityGb: 4,
    model: 'mini',
    generation: 'mini_1',
    displayName: 'iPod mini 4GB (1st Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: '9436',
    capacityGb: 4,
    model: 'mini_blue',
    generation: 'mini_1',
    displayName: 'iPod mini 4GB Blue (1st Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: '9435',
    capacityGb: 4,
    model: 'mini_pink',
    generation: 'mini_1',
    displayName: 'iPod mini 4GB Pink (1st Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: '9434',
    capacityGb: 4,
    model: 'mini_green',
    generation: 'mini_1',
    displayName: 'iPod mini 4GB Green (1st Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: '9437',
    capacityGb: 4,
    model: 'mini_gold',
    generation: 'mini_1',
    displayName: 'iPod mini 4GB Gold (1st Generation)',
    musicDirs: 6,
  },

  // Mini 2nd Generation
  {
    modelNumber: '9800',
    capacityGb: 4,
    model: 'mini',
    generation: 'mini_2',
    displayName: 'iPod mini 4GB (2nd Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: '9802',
    capacityGb: 4,
    model: 'mini_blue',
    generation: 'mini_2',
    displayName: 'iPod mini 4GB Blue (2nd Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: '9804',
    capacityGb: 4,
    model: 'mini_pink',
    generation: 'mini_2',
    displayName: 'iPod mini 4GB Pink (2nd Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: '9806',
    capacityGb: 4,
    model: 'mini_green',
    generation: 'mini_2',
    displayName: 'iPod mini 4GB Green (2nd Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: '9801',
    capacityGb: 6,
    model: 'mini',
    generation: 'mini_2',
    displayName: 'iPod mini 6GB (2nd Generation)',
    musicDirs: 20,
  },
  {
    modelNumber: '9803',
    capacityGb: 6,
    model: 'mini_blue',
    generation: 'mini_2',
    displayName: 'iPod mini 6GB Blue (2nd Generation)',
    musicDirs: 20,
  },
  {
    modelNumber: '9805',
    capacityGb: 6,
    model: 'mini_pink',
    generation: 'mini_2',
    displayName: 'iPod mini 6GB Pink (2nd Generation)',
    musicDirs: 20,
  },
  {
    modelNumber: '9807',
    capacityGb: 6,
    model: 'mini_green',
    generation: 'mini_2',
    displayName: 'iPod mini 6GB Green (2nd Generation)',
    musicDirs: 20,
  },

  // Photo / Fourth Generation (Color)
  {
    modelNumber: 'A079',
    capacityGb: 20,
    model: 'color',
    generation: 'photo',
    displayName: 'iPod Photo 20GB',
    musicDirs: 50,
  },
  {
    modelNumber: 'A127',
    capacityGb: 20,
    model: 'color_u2',
    generation: 'photo',
    displayName: 'iPod Photo 20GB U2',
    musicDirs: 50,
  },
  {
    modelNumber: '9829',
    capacityGb: 30,
    model: 'color',
    generation: 'photo',
    displayName: 'iPod Photo 30GB',
    musicDirs: 50,
  },
  {
    modelNumber: '9585',
    capacityGb: 40,
    model: 'color',
    generation: 'photo',
    displayName: 'iPod Photo 40GB',
    musicDirs: 50,
  },
  {
    modelNumber: '9830',
    capacityGb: 60,
    model: 'color',
    generation: 'photo',
    displayName: 'iPod Photo 60GB',
    musicDirs: 50,
  },
  {
    modelNumber: '9586',
    capacityGb: 60,
    model: 'color',
    generation: 'photo',
    displayName: 'iPod Photo 60GB',
    musicDirs: 50,
  },

  // Shuffle 1st Generation
  {
    modelNumber: '9724',
    capacityGb: 0.5,
    model: 'shuffle',
    generation: 'shuffle_1',
    displayName: 'iPod shuffle 512MB (1st Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: '9725',
    capacityGb: 1,
    model: 'shuffle',
    generation: 'shuffle_1',
    displayName: 'iPod shuffle 1GB (1st Generation)',
    musicDirs: 3,
  },

  // Shuffle 2nd Generation
  {
    modelNumber: 'A546',
    capacityGb: 1,
    model: 'shuffle_silver',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 1GB Silver (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'A947',
    capacityGb: 1,
    model: 'shuffle_pink',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 1GB Pink (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'A949',
    capacityGb: 1,
    model: 'shuffle_blue',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 1GB Blue (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'A951',
    capacityGb: 1,
    model: 'shuffle_green',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 1GB Green (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'A953',
    capacityGb: 1,
    model: 'shuffle_orange',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 1GB Orange (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C167',
    capacityGb: 1,
    model: 'shuffle_gold',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 1GB Gold (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'B225',
    capacityGb: 1,
    model: 'shuffle_silver',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 1GB Silver (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'B233',
    capacityGb: 1,
    model: 'shuffle_purple',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 1GB Purple (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'B231',
    capacityGb: 1,
    model: 'shuffle_red',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 1GB Red (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'B227',
    capacityGb: 1,
    model: 'shuffle_blue',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 1GB Blue (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'B228',
    capacityGb: 1,
    model: 'shuffle_blue',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 1GB Blue (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'B229',
    capacityGb: 1,
    model: 'shuffle_green',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 1GB Green (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'B518',
    capacityGb: 2,
    model: 'shuffle_silver',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 2GB Silver (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'B520',
    capacityGb: 2,
    model: 'shuffle_blue',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 2GB Blue (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'B522',
    capacityGb: 2,
    model: 'shuffle_green',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 2GB Green (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'B524',
    capacityGb: 2,
    model: 'shuffle_red',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 2GB Red (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'B526',
    capacityGb: 2,
    model: 'shuffle_purple',
    generation: 'shuffle_2',
    displayName: 'iPod shuffle 2GB Purple (2nd Generation)',
    musicDirs: 3,
  },

  // Shuffle 3rd Generation
  {
    modelNumber: 'C306',
    capacityGb: 2,
    model: 'shuffle_silver',
    generation: 'shuffle_3',
    displayName: 'iPod shuffle 2GB Silver (3rd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C323',
    capacityGb: 2,
    model: 'shuffle_black',
    generation: 'shuffle_3',
    displayName: 'iPod shuffle 2GB Black (3rd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C381',
    capacityGb: 2,
    model: 'shuffle_green',
    generation: 'shuffle_3',
    displayName: 'iPod shuffle 2GB Green (3rd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C384',
    capacityGb: 2,
    model: 'shuffle_blue',
    generation: 'shuffle_3',
    displayName: 'iPod shuffle 2GB Blue (3rd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C387',
    capacityGb: 2,
    model: 'shuffle_pink',
    generation: 'shuffle_3',
    displayName: 'iPod shuffle 2GB Pink (3rd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'B867',
    capacityGb: 4,
    model: 'shuffle_silver',
    generation: 'shuffle_3',
    displayName: 'iPod shuffle 4GB Silver (3rd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C164',
    capacityGb: 4,
    model: 'shuffle_black',
    generation: 'shuffle_3',
    displayName: 'iPod shuffle 4GB Black (3rd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C303',
    capacityGb: 4,
    model: 'shuffle_stainless',
    generation: 'shuffle_3',
    displayName: 'iPod shuffle 4GB Stainless (3rd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C307',
    capacityGb: 4,
    model: 'shuffle_green',
    generation: 'shuffle_3',
    displayName: 'iPod shuffle 4GB Green (3rd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C328',
    capacityGb: 4,
    model: 'shuffle_blue',
    generation: 'shuffle_3',
    displayName: 'iPod shuffle 4GB Blue (3rd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C331',
    capacityGb: 4,
    model: 'shuffle_pink',
    generation: 'shuffle_3',
    displayName: 'iPod shuffle 4GB Pink (3rd Generation)',
    musicDirs: 3,
  },

  // Shuffle 4th Generation
  {
    modelNumber: 'C584',
    capacityGb: 2,
    model: 'shuffle_silver',
    generation: 'shuffle_4',
    displayName: 'iPod shuffle 2GB Silver (4th Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C585',
    capacityGb: 2,
    model: 'shuffle_pink',
    generation: 'shuffle_4',
    displayName: 'iPod shuffle 2GB Pink (4th Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C749',
    capacityGb: 2,
    model: 'shuffle_orange',
    generation: 'shuffle_4',
    displayName: 'iPod shuffle 2GB Orange (4th Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C750',
    capacityGb: 2,
    model: 'shuffle_green',
    generation: 'shuffle_4',
    displayName: 'iPod shuffle 2GB Green (4th Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'C751',
    capacityGb: 2,
    model: 'shuffle_blue',
    generation: 'shuffle_4',
    displayName: 'iPod shuffle 2GB Blue (4th Generation)',
    musicDirs: 3,
  },

  // Nano 1st Generation
  {
    modelNumber: 'A350',
    capacityGb: 1,
    model: 'nano_white',
    generation: 'nano_1',
    displayName: 'iPod nano 1GB White (1st Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'A352',
    capacityGb: 1,
    model: 'nano_black',
    generation: 'nano_1',
    displayName: 'iPod nano 1GB Black (1st Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'A004',
    capacityGb: 2,
    model: 'nano_white',
    generation: 'nano_1',
    displayName: 'iPod nano 2GB White (1st Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'A099',
    capacityGb: 2,
    model: 'nano_black',
    generation: 'nano_1',
    displayName: 'iPod nano 2GB Black (1st Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'A005',
    capacityGb: 4,
    model: 'nano_white',
    generation: 'nano_1',
    displayName: 'iPod nano 4GB White (1st Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: 'A107',
    capacityGb: 4,
    model: 'nano_black',
    generation: 'nano_1',
    displayName: 'iPod nano 4GB Black (1st Generation)',
    musicDirs: 6,
  },

  // Video / 5th Generation (Video 1st Generation in libgpod terms)
  {
    modelNumber: 'A002',
    capacityGb: 30,
    model: 'video_white',
    generation: 'video_1',
    displayName: 'iPod Video 30GB White (5th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'A146',
    capacityGb: 30,
    model: 'video_black',
    generation: 'video_1',
    displayName: 'iPod Video 30GB Black (5th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'A003',
    capacityGb: 60,
    model: 'video_white',
    generation: 'video_1',
    displayName: 'iPod Video 60GB White (5th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'A147',
    capacityGb: 60,
    model: 'video_black',
    generation: 'video_1',
    displayName: 'iPod Video 60GB Black (5th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'A452',
    capacityGb: 30,
    model: 'video_u2',
    generation: 'video_1',
    displayName: 'iPod Video 30GB U2 (5th Generation)',
    musicDirs: 50,
  },

  // Video / 6th Generation (Video 2nd Generation in libgpod terms, aka 5.5th gen)
  {
    modelNumber: 'A444',
    capacityGb: 30,
    model: 'video_white',
    generation: 'video_2',
    displayName: 'iPod Video 30GB White (5.5th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'A446',
    capacityGb: 30,
    model: 'video_black',
    generation: 'video_2',
    displayName: 'iPod Video 30GB Black (5.5th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'A664',
    capacityGb: 30,
    model: 'video_u2',
    generation: 'video_2',
    displayName: 'iPod Video 30GB U2 (5.5th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'A448',
    capacityGb: 80,
    model: 'video_white',
    generation: 'video_2',
    displayName: 'iPod Video 80GB White (5.5th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'A450',
    capacityGb: 80,
    model: 'video_black',
    generation: 'video_2',
    displayName: 'iPod Video 80GB Black (5.5th Generation)',
    musicDirs: 50,
  },

  // Nano 2nd Generation
  {
    modelNumber: 'A477',
    capacityGb: 2,
    model: 'nano_silver',
    generation: 'nano_2',
    displayName: 'iPod nano 2GB Silver (2nd Generation)',
    musicDirs: 3,
  },
  {
    modelNumber: 'A426',
    capacityGb: 4,
    model: 'nano_silver',
    generation: 'nano_2',
    displayName: 'iPod nano 4GB Silver (2nd Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: 'A428',
    capacityGb: 4,
    model: 'nano_blue',
    generation: 'nano_2',
    displayName: 'iPod nano 4GB Blue (2nd Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: 'A487',
    capacityGb: 4,
    model: 'nano_green',
    generation: 'nano_2',
    displayName: 'iPod nano 4GB Green (2nd Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: 'A489',
    capacityGb: 4,
    model: 'nano_pink',
    generation: 'nano_2',
    displayName: 'iPod nano 4GB Pink (2nd Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: 'A725',
    capacityGb: 4,
    model: 'nano_red',
    generation: 'nano_2',
    displayName: 'iPod nano 4GB Red (2nd Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: 'A726',
    capacityGb: 8,
    model: 'nano_red',
    generation: 'nano_2',
    displayName: 'iPod nano 8GB Red (2nd Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: 'A497',
    capacityGb: 8,
    model: 'nano_black',
    generation: 'nano_2',
    displayName: 'iPod nano 8GB Black (2nd Generation)',
    musicDirs: 14,
  },

  // HP iPods
  {
    modelNumber: 'E436',
    capacityGb: 40,
    model: 'regular',
    generation: 'fourth',
    displayName: 'iPod HP 40GB (4th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'S492',
    capacityGb: 30,
    model: 'color',
    generation: 'photo',
    displayName: 'iPod HP Photo 30GB',
    musicDirs: 50,
  },

  // Classic 1st Generation (6th Generation overall)
  {
    modelNumber: 'B029',
    capacityGb: 80,
    model: 'classic_silver',
    generation: 'classic_1',
    displayName: 'iPod Classic 80GB Silver (6th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'B147',
    capacityGb: 80,
    model: 'classic_black',
    generation: 'classic_1',
    displayName: 'iPod Classic 80GB Black (6th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'B145',
    capacityGb: 160,
    model: 'classic_silver',
    generation: 'classic_1',
    displayName: 'iPod Classic 160GB Silver (6th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'B150',
    capacityGb: 160,
    model: 'classic_black',
    generation: 'classic_1',
    displayName: 'iPod Classic 160GB Black (6th Generation)',
    musicDirs: 50,
  },

  // Classic 2nd Generation (6th Generation revised)
  {
    modelNumber: 'B562',
    capacityGb: 120,
    model: 'classic_silver',
    generation: 'classic_2',
    displayName: 'iPod Classic 120GB Silver (6th Generation, rev.)',
    musicDirs: 50,
  },
  {
    modelNumber: 'B565',
    capacityGb: 120,
    model: 'classic_black',
    generation: 'classic_2',
    displayName: 'iPod Classic 120GB Black (6th Generation, rev.)',
    musicDirs: 50,
  },

  // Classic 3rd Generation (7th Generation overall)
  {
    modelNumber: 'C293',
    capacityGb: 160,
    model: 'classic_silver',
    generation: 'classic_3',
    displayName: 'iPod Classic 160GB Silver (7th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'C297',
    capacityGb: 160,
    model: 'classic_black',
    generation: 'classic_3',
    displayName: 'iPod Classic 160GB Black (7th Generation)',
    musicDirs: 50,
  },

  // Nano 3rd Generation (video nano)
  {
    modelNumber: 'A978',
    capacityGb: 4,
    model: 'nano_silver',
    generation: 'nano_3',
    displayName: 'iPod nano 4GB Silver (3rd Generation)',
    musicDirs: 6,
  },
  {
    modelNumber: 'A980',
    capacityGb: 8,
    model: 'nano_silver',
    generation: 'nano_3',
    displayName: 'iPod nano 8GB Silver (3rd Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B261',
    capacityGb: 8,
    model: 'nano_black',
    generation: 'nano_3',
    displayName: 'iPod nano 8GB Black (3rd Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B249',
    capacityGb: 8,
    model: 'nano_blue',
    generation: 'nano_3',
    displayName: 'iPod nano 8GB Blue (3rd Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B253',
    capacityGb: 8,
    model: 'nano_green',
    generation: 'nano_3',
    displayName: 'iPod nano 8GB Green (3rd Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B257',
    capacityGb: 8,
    model: 'nano_red',
    generation: 'nano_3',
    displayName: 'iPod nano 8GB Red (3rd Generation)',
    musicDirs: 14,
  },

  // Nano 4th Generation
  {
    modelNumber: 'B480',
    capacityGb: 4,
    model: 'nano_silver',
    generation: 'nano_4',
    displayName: 'iPod nano 4GB Silver (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B651',
    capacityGb: 4,
    model: 'nano_blue',
    generation: 'nano_4',
    displayName: 'iPod nano 4GB Blue (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B654',
    capacityGb: 4,
    model: 'nano_pink',
    generation: 'nano_4',
    displayName: 'iPod nano 4GB Pink (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B657',
    capacityGb: 4,
    model: 'nano_purple',
    generation: 'nano_4',
    displayName: 'iPod nano 4GB Purple (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B660',
    capacityGb: 4,
    model: 'nano_orange',
    generation: 'nano_4',
    displayName: 'iPod nano 4GB Orange (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B663',
    capacityGb: 4,
    model: 'nano_green',
    generation: 'nano_4',
    displayName: 'iPod nano 4GB Green (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B666',
    capacityGb: 4,
    model: 'nano_yellow',
    generation: 'nano_4',
    displayName: 'iPod nano 4GB Yellow (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B598',
    capacityGb: 8,
    model: 'nano_silver',
    generation: 'nano_4',
    displayName: 'iPod nano 8GB Silver (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B732',
    capacityGb: 8,
    model: 'nano_blue',
    generation: 'nano_4',
    displayName: 'iPod nano 8GB Blue (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B735',
    capacityGb: 8,
    model: 'nano_pink',
    generation: 'nano_4',
    displayName: 'iPod nano 8GB Pink (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B739',
    capacityGb: 8,
    model: 'nano_purple',
    generation: 'nano_4',
    displayName: 'iPod nano 8GB Purple (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B742',
    capacityGb: 8,
    model: 'nano_orange',
    generation: 'nano_4',
    displayName: 'iPod nano 8GB Orange (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B745',
    capacityGb: 8,
    model: 'nano_green',
    generation: 'nano_4',
    displayName: 'iPod nano 8GB Green (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B748',
    capacityGb: 8,
    model: 'nano_yellow',
    generation: 'nano_4',
    displayName: 'iPod nano 8GB Yellow (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B751',
    capacityGb: 8,
    model: 'nano_red',
    generation: 'nano_4',
    displayName: 'iPod nano 8GB Red (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B754',
    capacityGb: 8,
    model: 'nano_black',
    generation: 'nano_4',
    displayName: 'iPod nano 8GB Black (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B903',
    capacityGb: 16,
    model: 'nano_silver',
    generation: 'nano_4',
    displayName: 'iPod nano 16GB Silver (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B905',
    capacityGb: 16,
    model: 'nano_blue',
    generation: 'nano_4',
    displayName: 'iPod nano 16GB Blue (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B907',
    capacityGb: 16,
    model: 'nano_pink',
    generation: 'nano_4',
    displayName: 'iPod nano 16GB Pink (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B909',
    capacityGb: 16,
    model: 'nano_purple',
    generation: 'nano_4',
    displayName: 'iPod nano 16GB Purple (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B911',
    capacityGb: 16,
    model: 'nano_orange',
    generation: 'nano_4',
    displayName: 'iPod nano 16GB Orange (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B913',
    capacityGb: 16,
    model: 'nano_green',
    generation: 'nano_4',
    displayName: 'iPod nano 16GB Green (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B915',
    capacityGb: 16,
    model: 'nano_yellow',
    generation: 'nano_4',
    displayName: 'iPod nano 16GB Yellow (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B917',
    capacityGb: 16,
    model: 'nano_red',
    generation: 'nano_4',
    displayName: 'iPod nano 16GB Red (4th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'B918',
    capacityGb: 16,
    model: 'nano_black',
    generation: 'nano_4',
    displayName: 'iPod nano 16GB Black (4th Generation)',
    musicDirs: 14,
  },

  // Nano 5th Generation (with camera)
  {
    modelNumber: 'C027',
    capacityGb: 8,
    model: 'nano_silver',
    generation: 'nano_5',
    displayName: 'iPod nano 8GB Silver (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C031',
    capacityGb: 8,
    model: 'nano_black',
    generation: 'nano_5',
    displayName: 'iPod nano 8GB Black (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C034',
    capacityGb: 8,
    model: 'nano_purple',
    generation: 'nano_5',
    displayName: 'iPod nano 8GB Purple (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C037',
    capacityGb: 8,
    model: 'nano_blue',
    generation: 'nano_5',
    displayName: 'iPod nano 8GB Blue (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C040',
    capacityGb: 8,
    model: 'nano_green',
    generation: 'nano_5',
    displayName: 'iPod nano 8GB Green (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C043',
    capacityGb: 8,
    model: 'nano_yellow',
    generation: 'nano_5',
    displayName: 'iPod nano 8GB Yellow (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C046',
    capacityGb: 8,
    model: 'nano_orange',
    generation: 'nano_5',
    displayName: 'iPod nano 8GB Orange (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C049',
    capacityGb: 8,
    model: 'nano_red',
    generation: 'nano_5',
    displayName: 'iPod nano 8GB Red (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C050',
    capacityGb: 8,
    model: 'nano_pink',
    generation: 'nano_5',
    displayName: 'iPod nano 8GB Pink (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C060',
    capacityGb: 16,
    model: 'nano_silver',
    generation: 'nano_5',
    displayName: 'iPod nano 16GB Silver (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C062',
    capacityGb: 16,
    model: 'nano_black',
    generation: 'nano_5',
    displayName: 'iPod nano 16GB Black (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C064',
    capacityGb: 16,
    model: 'nano_purple',
    generation: 'nano_5',
    displayName: 'iPod nano 16GB Purple (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C066',
    capacityGb: 16,
    model: 'nano_blue',
    generation: 'nano_5',
    displayName: 'iPod nano 16GB Blue (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C068',
    capacityGb: 16,
    model: 'nano_green',
    generation: 'nano_5',
    displayName: 'iPod nano 16GB Green (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C070',
    capacityGb: 16,
    model: 'nano_yellow',
    generation: 'nano_5',
    displayName: 'iPod nano 16GB Yellow (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C072',
    capacityGb: 16,
    model: 'nano_orange',
    generation: 'nano_5',
    displayName: 'iPod nano 16GB Orange (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C074',
    capacityGb: 16,
    model: 'nano_red',
    generation: 'nano_5',
    displayName: 'iPod nano 16GB Red (5th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C075',
    capacityGb: 16,
    model: 'nano_pink',
    generation: 'nano_5',
    displayName: 'iPod nano 16GB Pink (5th Generation)',
    musicDirs: 14,
  },

  // Nano 6th Generation (touch nano)
  {
    modelNumber: 'C525',
    capacityGb: 8,
    model: 'nano_silver',
    generation: 'nano_6',
    displayName: 'iPod nano 8GB Silver (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C688',
    capacityGb: 8,
    model: 'nano_black',
    generation: 'nano_6',
    displayName: 'iPod nano 8GB Black (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C689',
    capacityGb: 8,
    model: 'nano_blue',
    generation: 'nano_6',
    displayName: 'iPod nano 8GB Blue (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C690',
    capacityGb: 8,
    model: 'nano_green',
    generation: 'nano_6',
    displayName: 'iPod nano 8GB Green (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C691',
    capacityGb: 8,
    model: 'nano_orange',
    generation: 'nano_6',
    displayName: 'iPod nano 8GB Orange (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C692',
    capacityGb: 8,
    model: 'nano_pink',
    generation: 'nano_6',
    displayName: 'iPod nano 8GB Pink (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C693',
    capacityGb: 8,
    model: 'nano_red',
    generation: 'nano_6',
    displayName: 'iPod nano 8GB Red (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C526',
    capacityGb: 16,
    model: 'nano_silver',
    generation: 'nano_6',
    displayName: 'iPod nano 16GB Silver (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C694',
    capacityGb: 16,
    model: 'nano_black',
    generation: 'nano_6',
    displayName: 'iPod nano 16GB Black (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C695',
    capacityGb: 16,
    model: 'nano_blue',
    generation: 'nano_6',
    displayName: 'iPod nano 16GB Blue (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C696',
    capacityGb: 16,
    model: 'nano_green',
    generation: 'nano_6',
    displayName: 'iPod nano 16GB Green (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C697',
    capacityGb: 16,
    model: 'nano_orange',
    generation: 'nano_6',
    displayName: 'iPod nano 16GB Orange (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C698',
    capacityGb: 16,
    model: 'nano_pink',
    generation: 'nano_6',
    displayName: 'iPod nano 16GB Pink (6th Generation)',
    musicDirs: 14,
  },
  {
    modelNumber: 'C699',
    capacityGb: 16,
    model: 'nano_red',
    generation: 'nano_6',
    displayName: 'iPod nano 16GB Red (6th Generation)',
    musicDirs: 14,
  },

  // iPod touch 1st Generation
  {
    modelNumber: 'A623',
    capacityGb: 8,
    model: 'touch_silver',
    generation: 'touch_1',
    displayName: 'iPod touch 8GB (1st Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'A627',
    capacityGb: 16,
    model: 'touch_silver',
    generation: 'touch_1',
    displayName: 'iPod touch 16GB (1st Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'B376',
    capacityGb: 32,
    model: 'touch_silver',
    generation: 'touch_1',
    displayName: 'iPod touch 32GB (1st Generation)',
    musicDirs: 50,
  },

  // iPod touch 2nd Generation
  {
    modelNumber: 'B528',
    capacityGb: 8,
    model: 'touch_silver',
    generation: 'touch_2',
    displayName: 'iPod touch 8GB (2nd Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'B531',
    capacityGb: 16,
    model: 'touch_silver',
    generation: 'touch_2',
    displayName: 'iPod touch 16GB (2nd Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'B533',
    capacityGb: 32,
    model: 'touch_silver',
    generation: 'touch_2',
    displayName: 'iPod touch 32GB (2nd Generation)',
    musicDirs: 50,
  },

  // iPod touch 3rd Generation
  // Note: 8GB model is hardware 2nd gen; 32/64GB are true 3rd gen
  {
    modelNumber: 'C086',
    capacityGb: 8,
    model: 'touch_silver',
    generation: 'touch_2',
    displayName: 'iPod touch 8GB (3rd Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'C008',
    capacityGb: 32,
    model: 'touch_silver',
    generation: 'touch_3',
    displayName: 'iPod touch 32GB (3rd Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'C011',
    capacityGb: 64,
    model: 'touch_silver',
    generation: 'touch_3',
    displayName: 'iPod touch 64GB (3rd Generation)',
    musicDirs: 50,
  },

  // iPod touch 4th Generation
  {
    modelNumber: 'C540',
    capacityGb: 8,
    model: 'touch_silver',
    generation: 'touch_4',
    displayName: 'iPod touch 8GB (4th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'C544',
    capacityGb: 32,
    model: 'touch_silver',
    generation: 'touch_4',
    displayName: 'iPod touch 32GB (4th Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'C547',
    capacityGb: 64,
    model: 'touch_silver',
    generation: 'touch_4',
    displayName: 'iPod touch 64GB (4th Generation)',
    musicDirs: 50,
  },

  // iPhone
  {
    modelNumber: 'A501',
    capacityGb: 4,
    model: 'iphone_1',
    generation: 'iphone_1',
    displayName: 'iPhone 4GB (1st Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'A712',
    capacityGb: 8,
    model: 'iphone_1',
    generation: 'iphone_1',
    displayName: 'iPhone 8GB (1st Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'B384',
    capacityGb: 16,
    model: 'iphone_1',
    generation: 'iphone_1',
    displayName: 'iPhone 16GB (1st Generation)',
    musicDirs: 50,
  },

  // iPhone 3G
  {
    modelNumber: 'B046',
    capacityGb: 8,
    model: 'iphone_black',
    generation: 'iphone_2',
    displayName: 'iPhone 3G 8GB Black',
    musicDirs: 50,
  },
  {
    modelNumber: 'B500',
    capacityGb: 16,
    model: 'iphone_white',
    generation: 'iphone_2',
    displayName: 'iPhone 3G 16GB White',
    musicDirs: 50,
  },
  {
    modelNumber: 'B048',
    capacityGb: 16,
    model: 'iphone_black',
    generation: 'iphone_2',
    displayName: 'iPhone 3G 16GB Black',
    musicDirs: 50,
  },
  {
    modelNumber: 'B496',
    capacityGb: 16,
    model: 'iphone_black',
    generation: 'iphone_2',
    displayName: 'iPhone 3G 16GB Black',
    musicDirs: 50,
  },

  // iPhone 3GS
  {
    modelNumber: 'C131',
    capacityGb: 16,
    model: 'iphone_black',
    generation: 'iphone_3',
    displayName: 'iPhone 3GS 16GB Black',
    musicDirs: 50,
  },
  {
    modelNumber: 'C133',
    capacityGb: 32,
    model: 'iphone_black',
    generation: 'iphone_3',
    displayName: 'iPhone 3GS 32GB Black',
    musicDirs: 50,
  },
  {
    modelNumber: 'C134',
    capacityGb: 32,
    model: 'iphone_white',
    generation: 'iphone_3',
    displayName: 'iPhone 3GS 32GB White',
    musicDirs: 50,
  },

  // iPhone 4
  {
    modelNumber: 'C603',
    capacityGb: 16,
    model: 'iphone_black',
    generation: 'iphone_4',
    displayName: 'iPhone 4 16GB Black',
    musicDirs: 50,
  },
  {
    modelNumber: 'C605',
    capacityGb: 32,
    model: 'iphone_black',
    generation: 'iphone_4',
    displayName: 'iPhone 4 32GB Black',
    musicDirs: 50,
  },

  // iPad (1st Generation)
  {
    modelNumber: 'B292',
    capacityGb: 16,
    model: 'ipad',
    generation: 'ipad_1',
    displayName: 'iPad 16GB (1st Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'B293',
    capacityGb: 32,
    model: 'ipad',
    generation: 'ipad_1',
    displayName: 'iPad 32GB (1st Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'B294',
    capacityGb: 64,
    model: 'ipad',
    generation: 'ipad_1',
    displayName: 'iPad 64GB (1st Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'C349',
    capacityGb: 16,
    model: 'ipad',
    generation: 'ipad_1',
    displayName: 'iPad 16GB 3G (1st Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'C496',
    capacityGb: 32,
    model: 'ipad',
    generation: 'ipad_1',
    displayName: 'iPad 32GB 3G (1st Generation)',
    musicDirs: 50,
  },
  {
    modelNumber: 'C497',
    capacityGb: 64,
    model: 'ipad',
    generation: 'ipad_1',
    displayName: 'iPad 64GB 3G (1st Generation)',
    musicDirs: 50,
  },

  // Mobile (no known model number)
  {
    modelNumber: 'mobile1',
    capacityGb: 0,
    model: 'mobile_1',
    generation: 'mobile',
    displayName: 'Mobile Phone',
    musicDirs: 6,
  },
];

// ---------------------------------------------------------------------------
// Lookup index (populated once)
// ---------------------------------------------------------------------------

/**
 * Map from upper-cased `modelNumber` (the stripped form, e.g. "A147") to info.
 */
const MODEL_INDEX = new Map<string, IpodModelInfo>();

for (const entry of MODEL_TABLE) {
  // The SysInfo file writes "MA147"; libgpod strips the "M" to get "A147".
  // We store both `modelNumber` (stripped) and `fullModelNumber` (with "M").
  const info: IpodModelInfo = {
    modelNumber: entry.modelNumber,
    fullModelNumber: `M${entry.modelNumber}`,
    capacityGb: entry.capacityGb,
    model: entry.model,
    generation: entry.generation,
    displayName: entry.displayName,
    musicDirs: entry.musicDirs,
  };
  MODEL_INDEX.set(entry.modelNumber.toUpperCase(), info);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up model information by model number.
 *
 * Accepts both the full SysInfo form (e.g. "MA147") and the stripped form
 * (e.g. "A147"). The comparison is case-insensitive.
 *
 * @param modelNumber - Model number string, with or without leading "M".
 * @returns Model info, or `undefined` if the model number is not in the table.
 */
export function getModelInfo(modelNumber: string): IpodModelInfo | undefined {
  if (!modelNumber) return undefined;

  // Strip leading "M" if present (SysInfo format → internal format)
  const stripped =
    modelNumber.startsWith('M') || modelNumber.startsWith('m') ? modelNumber.slice(1) : modelNumber;

  return MODEL_INDEX.get(stripped.toUpperCase());
}

/**
 * Return the human-readable display name for a model.
 *
 * This is a convenience wrapper around `info.displayName`.
 *
 * @param info - Model info record from `getModelInfo`.
 * @returns Display name string.
 */
export function getDisplayName(info: IpodModelInfo): string {
  return info.displayName;
}

/**
 * Check whether a device generation supports album artwork.
 *
 * All generations support artwork except the first two Shuffle generations
 * (which have no screen and no firmware support for artwork).
 *
 * @param generation - Device generation.
 * @returns `true` if the generation supports artwork.
 */
export function supportsArtwork(generation: IpodGeneration): boolean {
  return generation !== 'shuffle_1' && generation !== 'shuffle_2';
}

/**
 * Check whether a device generation supports video playback.
 *
 * Video is supported on:
 * - iPod Video (video_1, video_2)
 * - iPod Classic all generations (classic_1, classic_2, classic_3)
 * - iPod nano 3rd generation and later (nano_3 through nano_6)
 * - iPod touch all generations (touch_1 through touch_4)
 * - iPhone all generations (iphone_1 through iphone_4)
 * - iPad 1st generation (ipad_1)
 *
 * @param generation - Device generation.
 * @returns `true` if the generation supports video.
 */
export function supportsVideo(generation: IpodGeneration): boolean {
  switch (generation) {
    case 'video_1':
    case 'video_2':
    case 'classic_1':
    case 'classic_2':
    case 'classic_3':
    case 'nano_3':
    case 'nano_4':
    case 'nano_5':
    case 'nano_6':
    case 'touch_1':
    case 'touch_2':
    case 'touch_3':
    case 'touch_4':
    case 'iphone_1':
    case 'iphone_2':
    case 'iphone_3':
    case 'iphone_4':
    case 'ipad_1':
      return true;
    default:
      return false;
  }
}
