import { atom } from 'jotai';
import type { StorageStatus } from '../storage/types.js';

export const connectionStatusAtom = atom<StorageStatus>({ state: 'connecting' });
