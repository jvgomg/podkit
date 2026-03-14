/**
 * Data-driven E2E tests for iPod model compatibility.
 *
 * Tests are generated from the model capability matrix.
 * Each testable model gets a suite that verifies:
 * - Database initialization succeeds
 * - Reported capabilities match expected features
 * - Basic track operations work
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { withTestIpod } from '@podkit/gpod-testing';
import { TESTABLE_MODELS } from '@podkit/compatibility';

describe('iPod model compatibility', () => {
  for (const model of TESTABLE_MODELS) {
    describe(`${model.name} (${model.modelNumber})`, () => {
      it('initializes database successfully', async () => {
        await withTestIpod(async (ipod) => {
          const info = await ipod.info();
          expect(info.path).toBeTruthy();
          expect(info.playlistCount).toBeGreaterThanOrEqual(1); // master playlist
        }, { model: model.modelNumber });
      });

      it('reports correct artwork support', async () => {
        await withTestIpod(async (ipod) => {
          const info = await ipod.info();
          expect(info.device.supportsArtwork).toBe(model.features.artwork);
        }, { model: model.modelNumber });
      });

      it('reports correct video support', async () => {
        await withTestIpod(async (ipod) => {
          const info = await ipod.info();
          expect(info.device.supportsVideo).toBe(model.features.video);
        }, { model: model.modelNumber });
      });

      it('can add and retrieve a track', async () => {
        await withTestIpod(async (ipod) => {
          await ipod.addTrack({
            title: 'Test Track',
            artist: 'Test Artist',
            album: 'Test Album',
          });

          const tracks = await ipod.tracks();
          expect(tracks).toHaveLength(1);
          expect(tracks[0].title).toBe('Test Track');
          expect(tracks[0].artist).toBe('Test Artist');
          expect(tracks[0].album).toBe('Test Album');
        }, { model: model.modelNumber });
      });

      it('passes database verification', async () => {
        await withTestIpod(async (ipod) => {
          await ipod.addTrack({ title: 'Verify Track' });
          const result = await ipod.verify();
          expect(result.valid).toBe(true);
          expect(result.trackCount).toBe(1);
        }, { model: model.modelNumber });
      });
    });
  }
});
