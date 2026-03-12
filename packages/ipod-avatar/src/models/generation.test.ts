import { describe, expect, it } from 'bun:test';
import { generationToModelFamily } from './index.js';

describe('generationToModelFamily', () => {
  it('maps Classic/Video generations', () => {
    expect(generationToModelFamily('first')).toBe('classic');
    expect(generationToModelFamily('second')).toBe('classic');
    expect(generationToModelFamily('third')).toBe('classic');
    expect(generationToModelFamily('fourth')).toBe('classic');
    expect(generationToModelFamily('photo')).toBe('classic');
    expect(generationToModelFamily('video_1')).toBe('classic');
    expect(generationToModelFamily('video_2')).toBe('classic');
    expect(generationToModelFamily('classic_1')).toBe('classic');
    expect(generationToModelFamily('classic_2')).toBe('classic');
    expect(generationToModelFamily('classic_3')).toBe('classic');
  });

  it('maps Mini generations', () => {
    expect(generationToModelFamily('mini_1')).toBe('mini');
    expect(generationToModelFamily('mini_2')).toBe('mini');
  });

  it('maps Nano tall generations (1st-2nd)', () => {
    expect(generationToModelFamily('nano_1')).toBe('nano-tall');
    expect(generationToModelFamily('nano_2')).toBe('nano-tall');
  });

  it('maps Nano short generation (3rd)', () => {
    expect(generationToModelFamily('nano_3')).toBe('nano-short');
  });

  it('maps Nano slim generations (4th-5th)', () => {
    expect(generationToModelFamily('nano_4')).toBe('nano-slim');
    expect(generationToModelFamily('nano_5')).toBe('nano-slim');
  });

  it('maps supported Shuffle generations', () => {
    expect(generationToModelFamily('shuffle_1')).toBe('shuffle');
    expect(generationToModelFamily('shuffle_2')).toBe('shuffle');
  });

  it('maps unsupported generations to unknown', () => {
    expect(generationToModelFamily('nano_6')).toBe('unknown');
    expect(generationToModelFamily('shuffle_3')).toBe('unknown');
    expect(generationToModelFamily('shuffle_4')).toBe('unknown');
    expect(generationToModelFamily('touch_1')).toBe('unknown');
    expect(generationToModelFamily('touch_2')).toBe('unknown');
    expect(generationToModelFamily('touch_3')).toBe('unknown');
    expect(generationToModelFamily('touch_4')).toBe('unknown');
    expect(generationToModelFamily('iphone_1')).toBe('unknown');
    expect(generationToModelFamily('iphone_2')).toBe('unknown');
    expect(generationToModelFamily('iphone_3')).toBe('unknown');
    expect(generationToModelFamily('iphone_4')).toBe('unknown');
    expect(generationToModelFamily('ipad_1')).toBe('unknown');
    expect(generationToModelFamily('mobile')).toBe('unknown');
  });

  it('maps unknown generation string to unknown', () => {
    expect(generationToModelFamily('unknown')).toBe('unknown');
  });

  it('maps completely unrecognized strings to unknown', () => {
    expect(generationToModelFamily('future_model')).toBe('unknown');
    expect(generationToModelFamily('')).toBe('unknown');
  });
});
