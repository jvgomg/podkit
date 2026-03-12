export type IpodModelFamily =
  | 'classic'
  | 'mini'
  | 'nano-tall'
  | 'nano-short'
  | 'nano-slim'
  | 'shuffle'
  | 'unknown';

export type Expression =
  | 'neutral'
  | 'happy'
  | 'excited'
  | 'sleepy'
  | 'concerned'
  | 'syncing'
  | 'satisfied';

export type AvatarColor =
  | 'silver'
  | 'white'
  | 'black'
  | 'pink'
  | 'blue'
  | 'green'
  | 'gold'
  | 'red'
  | 'purple'
  | 'orange'
  | 'yellow';

export type Theme = 'dark' | 'light' | 'auto';

export interface RenderOptions {
  model: IpodModelFamily;
  color: AvatarColor;
  expression: Expression;
  theme?: Theme;
  noColor?: boolean;
  label?: string;
}

export interface SyncFrameOptions {
  model: IpodModelFamily;
  color: AvatarColor;
  progress: number;
  theme?: Theme;
  noColor?: boolean;
  label?: string;
}

export type WheelStyle = 'large' | 'small' | 'none';

export interface ModelTemplate {
  family: IpodModelFamily;
  wheelStyle: WheelStyle;
  width: number;
  height: number;
  build: (face: FaceLines, colorize: Colorize) => string[];
}

export interface FaceLines {
  eyes: string;
  mouth: string;
  sideMark?: string;
}

export type Colorize = (text: string) => string;
