export { renderAvatar, renderSyncFrames } from './render.js';
export { generationToModelFamily, getAllTemplates, getTemplate } from './models/index.js';
export { ALL_COLORS as getAvailableColors, getColorLabel } from './colors.js';
export { detectTheme, shouldShowAvatar } from './terminal.js';
export type {
  IpodModelFamily,
  Expression,
  AvatarColor,
  Theme,
  RenderOptions,
  SyncFrameOptions,
} from './types.js';
