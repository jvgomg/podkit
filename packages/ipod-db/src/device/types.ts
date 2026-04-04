/**
 * iPod device type definitions for @podkit/ipod-db.
 *
 * These types mirror the definitions in @podkit/libgpod-node but are
 * duplicated here so that ipod-db remains a standalone package with zero
 * external dependencies.
 */

/**
 * iPod generation identifier.
 *
 * Values match those used in @podkit/libgpod-node/src/types.ts so they are
 * interchangeable at runtime even though the types are declared separately.
 */
export type IpodGeneration =
  | 'unknown'
  | 'first'
  | 'second'
  | 'third'
  | 'fourth'
  | 'photo'
  | 'mobile'
  | 'mini_1'
  | 'mini_2'
  | 'shuffle_1'
  | 'shuffle_2'
  | 'shuffle_3'
  | 'shuffle_4'
  | 'nano_1'
  | 'nano_2'
  | 'nano_3'
  | 'nano_4'
  | 'nano_5'
  | 'nano_6'
  | 'video_1'
  | 'video_2'
  | 'classic_1'
  | 'classic_2'
  | 'classic_3'
  | 'touch_1'
  | 'touch_2'
  | 'touch_3'
  | 'touch_4'
  | 'iphone_1'
  | 'iphone_2'
  | 'iphone_3'
  | 'iphone_4'
  | 'ipad_1';

/**
 * iPod model identifier.
 *
 * Values match those used in @podkit/libgpod-node/src/types.ts.
 */
export type IpodModel =
  | 'invalid'
  | 'unknown'
  | 'color'
  | 'color_u2'
  | 'regular'
  | 'regular_u2'
  | 'mini'
  | 'mini_blue'
  | 'mini_pink'
  | 'mini_green'
  | 'mini_gold'
  | 'shuffle'
  | 'nano_white'
  | 'nano_black'
  | 'video_white'
  | 'video_black'
  | 'mobile_1'
  | 'video_u2'
  | 'nano_silver'
  | 'nano_blue'
  | 'nano_green'
  | 'nano_pink'
  | 'nano_red'
  | 'nano_yellow'
  | 'nano_purple'
  | 'nano_orange'
  | 'iphone_1'
  | 'shuffle_silver'
  | 'shuffle_pink'
  | 'shuffle_blue'
  | 'shuffle_green'
  | 'shuffle_orange'
  | 'shuffle_purple'
  | 'shuffle_red'
  | 'shuffle_black'
  | 'classic_silver'
  | 'classic_black'
  | 'touch_silver'
  | 'iphone_white'
  | 'iphone_black'
  | 'shuffle_gold'
  | 'shuffle_stainless'
  | 'ipad';

/**
 * Parsed data from an iPod SysInfo text file.
 */
export interface SysInfoData {
  /** ModelNumStr value, e.g. "MA147". Null if absent. */
  modelNumber: string | null;
  /** FirewireGuid value, e.g. "0x0000A00000000001". Null if absent. */
  firewireGuid: string | null;
  /** All parsed key-value pairs (keys stored in original case). */
  raw: Map<string, string>;
}

/**
 * Capability and identification information for a specific iPod model.
 *
 * Ported from the ipod_info_table in libgpod's itdb_device.c.
 */
export interface IpodModelInfo {
  /**
   * Model number without the leading letter, as it appears in the C table.
   * e.g. "A147"
   */
  modelNumber: string;
  /**
   * Full model number as it appears in the SysInfo ModelNumStr field,
   * i.e. with the "M" prefix restored.
   * e.g. "MA147"
   */
  fullModelNumber: string;
  /** Storage capacity in GB. */
  capacityGb: number;
  /** Model type. */
  model: IpodModel;
  /** Device generation. */
  generation: IpodGeneration;
  /** Human-readable display name. */
  displayName: string;
  /**
   * Number of music directories on the device (F00–F(N-1)).
   * Typically 3, 6, 14, 20, or 50 depending on capacity.
   */
  musicDirs: number;
}
