/**
 * Tier-1 smoke tests for the `echo-mini-populated` persona.
 *
 * Pins the synthesis recipe (same Echo Mini USB identity as the empty sibling,
 * FAT32 backing with 5 synthetic track files) so future schema changes can't
 * drop the populated-state content or accidentally merge the two personas.
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { echoMiniPopulated } from './echo-mini-populated/persona.js';
import { echoMini } from './echo-mini/persona.js';
import { personas } from './index.js';

describe('echo-mini-populated persona (synthesised, TASK-324 Phase 5)', () => {
  it('is registered in the persona registry under its declared id', () => {
    expect(personas.get('echo-mini-populated')).toBe(echoMiniPopulated);
  });

  it('is a distinct entry from echo-mini (empty sibling)', () => {
    expect(echoMiniPopulated).not.toBe(echoMini);
    expect(echoMiniPopulated.id).toBe('echo-mini-populated');
    expect(echoMini.id).toBe('echo-mini');
  });

  it('shares the same USB identity as the empty echo-mini sibling', () => {
    // Same vendor/product — the preset resolver maps 0x071b:0x3203 to
    // the echo-mini preset regardless of content state.
    expect(echoMiniPopulated.usbDescriptor.vendorId).toBe(echoMini.usbDescriptor.vendorId);
    expect(echoMiniPopulated.usbDescriptor.productId).toBe(echoMini.usbDescriptor.productId);
  });

  it('has expectedReadiness.level === ready', () => {
    // Content presence doesn't affect the readiness level — the device is
    // still ready regardless of whether tracks are present.
    expect(echoMiniPopulated.expectedReadiness.level).toBe('ready');
  });

  it('shares the same capabilities as the empty echo-mini sibling', () => {
    // Capabilities come from the preset, not from filesystem content.
    expect(echoMiniPopulated.expectedCapabilities).toEqual(echoMini.expectedCapabilities);
  });

  it('has a FAT32 backing file synthesis recipe', () => {
    const backing = echoMiniPopulated.massStorageBackingFile;
    expect(backing).not.toBeNull();
    expect(backing?.synthesis).toBeDefined();
    expect(backing?.synthesis?.filesystem).toBe('FAT32');
    expect(backing?.synthesis?.sizeMiB).toBe(64);
  });

  it('synthesis recipe has exactly 5 initial content entries (track-01 through track-05)', () => {
    const content = echoMiniPopulated.massStorageBackingFile?.synthesis?.initialContent;
    expect(content).toBeDefined();
    expect(content!).toHaveLength(5);
    // All entries should be in Music/ and named track-0N.mp3.
    for (const entry of content!) {
      expect(entry.path).toMatch(/^Music\/track-0[1-5]\.mp3$/);
      expect(entry.sourceFixture).toMatch(/track-0[1-5]\.mp3$/);
    }
  });

  it('synthesis label differs from the empty echo-mini sibling (images are distinguishable)', () => {
    // Different labels prevent Tier-3 from confusing the two images.
    expect(echoMiniPopulated.massStorageBackingFile?.synthesis?.label).not.toBe(
      echoMini.massStorageBackingFile?.synthesis?.label
    );
  });

  it('has sysInfoExtendedXml === null (mass-storage device; no SIE)', () => {
    expect(echoMiniPopulated.sysInfoExtendedXml).toBeNull();
  });

  it('is marked synthesised in its provenance', () => {
    expect(echoMiniPopulated.provenance.source).toBe('synthesised');
  });
});
