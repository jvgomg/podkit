import { atom } from 'jotai';
import type { IpodDatabase } from '../firmware/types.js';

/** The loaded database instance. Null until a StorageProvider loads it. */
export const databaseAtom = atom<IpodDatabase | null>(null);
