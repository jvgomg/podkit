import type { IpodModelFamily, ModelTemplate } from '../types.js';
import { classicTemplate, SCREEN_WIDTH as classicScreenWidth } from './classic.js';
import { miniTemplate, SCREEN_WIDTH as miniScreenWidth } from './mini.js';
import { nanoTallTemplate, SCREEN_WIDTH as nanoTallScreenWidth } from './nano-tall.js';
import { nanoShortTemplate, SCREEN_WIDTH as nanoShortScreenWidth } from './nano-short.js';
import { nanoSlimTemplate, SCREEN_WIDTH as nanoSlimScreenWidth } from './nano-slim.js';
import { shuffleTemplate } from './shuffle.js';
import { unknownTemplate, SCREEN_WIDTH as unknownScreenWidth } from './unknown.js';

const TEMPLATES: Record<IpodModelFamily, ModelTemplate> = {
  classic: classicTemplate,
  mini: miniTemplate,
  'nano-tall': nanoTallTemplate,
  'nano-short': nanoShortTemplate,
  'nano-slim': nanoSlimTemplate,
  shuffle: shuffleTemplate,
  unknown: unknownTemplate,
};

const SCREEN_WIDTHS: Record<IpodModelFamily, number> = {
  classic: classicScreenWidth,
  mini: miniScreenWidth,
  'nano-tall': nanoTallScreenWidth,
  'nano-short': nanoShortScreenWidth,
  'nano-slim': nanoSlimScreenWidth,
  shuffle: 0,
  unknown: unknownScreenWidth,
};

export function getTemplate(model: IpodModelFamily): ModelTemplate {
  return TEMPLATES[model];
}

export function getScreenWidth(model: IpodModelFamily): number {
  return SCREEN_WIDTHS[model];
}

export function getAllTemplates(): ModelTemplate[] {
  return Object.values(TEMPLATES);
}

const GENERATION_MAP: Record<string, IpodModelFamily> = {
  // Classic / Video
  unknown: 'unknown',
  first: 'classic',
  second: 'classic',
  third: 'classic',
  fourth: 'classic',
  photo: 'classic',
  video_1: 'classic',
  video_2: 'classic',
  classic_1: 'classic',
  classic_2: 'classic',
  classic_3: 'classic',
  // Mini
  mini_1: 'mini',
  mini_2: 'mini',
  // Nano tall (1st-2nd)
  nano_1: 'nano-tall',
  nano_2: 'nano-tall',
  // Nano short/fat (3rd)
  nano_3: 'nano-short',
  // Nano slim (4th-5th)
  nano_4: 'nano-slim',
  nano_5: 'nano-slim',
  // Shuffle (supported)
  shuffle_1: 'shuffle',
  shuffle_2: 'shuffle',
  // Unsupported → Unknown
  nano_6: 'unknown',
  shuffle_3: 'unknown',
  shuffle_4: 'unknown',
  touch_1: 'unknown',
  touch_2: 'unknown',
  touch_3: 'unknown',
  touch_4: 'unknown',
  iphone_1: 'unknown',
  iphone_2: 'unknown',
  iphone_3: 'unknown',
  iphone_4: 'unknown',
  ipad_1: 'unknown',
  mobile: 'unknown',
};

export function generationToModelFamily(generation: string): IpodModelFamily {
  return GENERATION_MAP[generation] ?? 'unknown';
}
