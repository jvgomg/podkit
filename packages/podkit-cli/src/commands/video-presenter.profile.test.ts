/**
 * Video device-profile selection in VideoPresenter.computeDiff: the identity
 * cascade's generation id wins over libgpod's generation, which is `unknown`
 * for devices libgpod's tables miss.
 */

import { describe, expect, it } from 'bun:test';
import * as core from '@podkit/core';
import type { VideoDeviceProfile } from '@podkit/core';
import { VideoPresenter } from './video-presenter.js';
import type { VideoContentConfig } from './sync-presenter.js';

function selectedProfile(libgpodGeneration: string, ipodGenerationId?: string): string {
  let captured: VideoDeviceProfile | undefined;
  const spyCore = {
    ...core,
    createVideoHandler: (cfg: Parameters<typeof core.createVideoHandler>[0]) => {
      captured = cfg?.deviceProfile;
      return core.createVideoHandler(cfg);
    },
  } as typeof core;
  const device = {
    getIpodDatabase: () => ({ getInfo: () => ({ device: { generation: libgpodGeneration } }) }),
  };
  const config: VideoContentConfig = {
    type: 'video',
    effectiveVideoQuality: 'high',
    effectiveVideoTransforms: core.DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    effectiveTransferMode: undefined,
    forceMetadata: false,
    ipodGenerationId,
  };
  new VideoPresenter().computeDiff([], [], config, device, spyCore);
  return captured!.name;
}

describe('VideoPresenter device profile', () => {
  it('uses the Nano 7G profile when the cascade says nano_7g and libgpod says unknown', () => {
    expect(selectedProfile('unknown', 'nano_7g')).toBe('ipod-nano-7g');
  });

  it("falls back to libgpod's generation without a cascade generation id", () => {
    expect(selectedProfile('video_1')).toBe('ipod-video-5g');
  });
});
