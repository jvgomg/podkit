import type { ModelEntry } from './types';

/**
 * Complete iPod model compatibility matrix.
 *
 * One representative model per supported iPod generation.
 * All 19 models can be tested with dummy databases.
 */
export const MODEL_MATRIX: ModelEntry[] = [
  // === iPod Classic / Video series ===
  {
    modelNumber: 'M8513',
    name: 'iPod 5GB (1st Gen)',
    generation: 'first',
    features: { music: true, artwork: false, video: false, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },
  {
    modelNumber: 'M8737',
    name: 'iPod 10GB (2nd Gen)',
    generation: 'second',
    features: { music: true, artwork: false, video: false, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },
  {
    modelNumber: 'M8976',
    name: 'iPod 10GB (3rd Gen)',
    generation: 'third',
    features: { music: true, artwork: false, video: false, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },
  {
    modelNumber: 'M9282',
    name: 'iPod 20GB (4th Gen)',
    generation: 'fourth',
    features: { music: true, artwork: false, video: false, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },
  {
    modelNumber: 'MA079',
    name: 'iPod Photo 20GB',
    generation: 'photo',
    features: { music: true, artwork: true, video: false, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },
  {
    modelNumber: 'MA147',
    name: 'iPod Video 60GB (5th Gen)',
    generation: 'video_1',
    features: { music: true, artwork: true, video: true, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },
  {
    modelNumber: 'MA450',
    name: 'iPod Video 80GB (5.5th Gen)',
    generation: 'video_2',
    features: { music: true, artwork: true, video: true, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },
  {
    modelNumber: 'MB029',
    name: 'iPod Classic 80GB (6th Gen)',
    generation: 'classic_1',
    features: { music: true, artwork: true, video: true, playlists: true },
    checksumType: 'hash58',
    canCreateDummy: true,
  },
  {
    modelNumber: 'MB565',
    name: 'iPod Classic 120GB (6th Gen)',
    generation: 'classic_2',
    features: { music: true, artwork: true, video: true, playlists: true },
    checksumType: 'hash58',
    canCreateDummy: true,
  },
  {
    modelNumber: 'MC293',
    name: 'iPod Classic 160GB (7th Gen)',
    generation: 'classic_3',
    features: { music: true, artwork: true, video: true, playlists: true },
    checksumType: 'hash58',
    canCreateDummy: true,
  },

  // === iPod Nano series ===
  {
    modelNumber: 'MA004',
    name: 'iPod Nano 2GB (1st Gen)',
    generation: 'nano_1',
    features: { music: true, artwork: true, video: false, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },
  {
    modelNumber: 'MA477',
    name: 'iPod Nano 2GB (2nd Gen)',
    generation: 'nano_2',
    features: { music: true, artwork: true, video: false, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },
  {
    modelNumber: 'MA978',
    name: 'iPod Nano 4GB (3rd Gen)',
    generation: 'nano_3',
    features: { music: true, artwork: true, video: true, playlists: true },
    checksumType: 'hash58',
    canCreateDummy: true,
  },
  {
    modelNumber: 'MB598',
    name: 'iPod Nano 8GB (4th Gen)',
    generation: 'nano_4',
    features: { music: true, artwork: true, video: true, playlists: true },
    checksumType: 'hash58',
    canCreateDummy: true,
  },
  {
    modelNumber: 'MC027',
    name: 'iPod Nano 8GB (5th Gen)',
    generation: 'nano_5',
    features: { music: true, artwork: true, video: true, playlists: true },
    checksumType: 'hash72',
    canCreateDummy: true,
  },

  // === iPod Mini series ===
  {
    modelNumber: 'M9160',
    name: 'iPod Mini 4GB (1st Gen)',
    generation: 'mini_1',
    features: { music: true, artwork: false, video: false, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },
  {
    modelNumber: 'M9800',
    name: 'iPod Mini 4GB (2nd Gen)',
    generation: 'mini_2',
    features: { music: true, artwork: false, video: false, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },

  // === iPod Shuffle series ===
  {
    modelNumber: 'M9724',
    name: 'iPod Shuffle 512MB (1st Gen)',
    generation: 'shuffle_1',
    features: { music: true, artwork: false, video: false, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },
  {
    modelNumber: 'MA546',
    name: 'iPod Shuffle 1GB (2nd Gen)',
    generation: 'shuffle_2',
    features: { music: true, artwork: false, video: false, playlists: true },
    checksumType: 'none',
    canCreateDummy: true,
  },
];
