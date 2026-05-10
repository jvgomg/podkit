import { describe, expect, it } from 'bun:test';
import {
  CollectionErrorCodes,
  CompletionsErrorCodes,
  DeviceErrorCodes,
  DoctorErrorCodes,
  EjectErrorCodes,
  InitErrorCodes,
  MigrateErrorCodes,
  MountErrorCodes,
  SyncErrorCodes,
} from './error-codes.js';

describe('per-command error code enums', () => {
  it('every code in MountErrorCodes maps to its own SCREAMING_SNAKE name', () => {
    for (const [k, v] of Object.entries(MountErrorCodes)) {
      expect(v).toBe(k);
      expect(k).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  // Sanity-check every other enum follows the same shape.
  const all = {
    EjectErrorCodes,
    InitErrorCodes,
    MigrateErrorCodes,
    CompletionsErrorCodes,
    CollectionErrorCodes,
    DeviceErrorCodes,
    DoctorErrorCodes,
    SyncErrorCodes,
  } as const;

  for (const [name, codes] of Object.entries(all)) {
    it(`${name} entries are non-empty SCREAMING_SNAKE_CASE strings that equal their key`, () => {
      const entries = Object.entries(codes);
      expect(entries.length).toBeGreaterThan(0);
      for (const [k, v] of entries) {
        expect(typeof v).toBe('string');
        expect(v).toBe(k);
        expect(k).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    });
  }

  it('overlapping codes across commands have the same string value', () => {
    // CORE_LOAD_FAILED appears in many commands. They should all use the
    // same string so consumers can deduplicate.
    const coreLoadFailedCodes = [
      MountErrorCodes.CORE_LOAD_FAILED,
      EjectErrorCodes.CORE_LOAD_FAILED,
      DoctorErrorCodes.CORE_LOAD_FAILED,
      SyncErrorCodes.CORE_LOAD_FAILED,
      DeviceErrorCodes.CORE_LOAD_FAILED,
    ];
    for (const code of coreLoadFailedCodes) {
      expect(code).toBe('CORE_LOAD_FAILED');
    }
  });
});
