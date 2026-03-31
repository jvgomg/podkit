import { describe, it, expect } from 'bun:test';
import { ejectWithRetry, isRetryableError } from './eject.js';
import type { DeviceManager, EjectResult, EjectProgressEvent } from './types.js';

/**
 * Create a mock DeviceManager with a controllable eject() method.
 */
function createMockManager(
  ejectResponses: EjectResult[]
): DeviceManager & { ejectCallCount: number; ejectCalls: string[] } {
  let callIndex = 0;
  return {
    platform: 'test',
    isSupported: true,
    ejectCallCount: 0,
    ejectCalls: [],
    async eject(mountPoint: string, _options?) {
      this.ejectCallCount++;
      this.ejectCalls.push(mountPoint);
      const response = ejectResponses[callIndex] ?? ejectResponses[ejectResponses.length - 1]!;
      callIndex++;
      return response;
    },
    async mount() {
      return { success: false, device: '' };
    },
    async listDevices() {
      return [];
    },
    async findIpodDevices() {
      return [];
    },
    async findByVolumeUuid() {
      return null;
    },
    getManualInstructions() {
      return '';
    },
    requiresPrivileges() {
      return false;
    },
    async getUuidForMountPoint() {
      return null;
    },
    async assessDevice() {
      return null;
    },
    async getSiblingVolumes() {
      return [];
    },
  };
}

describe('isRetryableError', () => {
  it('returns true for macOS dissent errors', () => {
    expect(
      isRetryableError('Volume TERAPOD on disk5s2 failed to unmount: dissented by PID 377')
    ).toBe(true);
  });

  it('returns true for "failed to unmount" errors', () => {
    expect(isRetryableError('failed to unmount volume')).toBe(true);
  });

  it('returns true for "resource busy" errors', () => {
    expect(isRetryableError('resource busy')).toBe(true);
  });

  it('returns true for "target is busy" errors', () => {
    expect(isRetryableError('umount: /mnt/ipod: target is busy')).toBe(true);
  });

  it('returns true for "device is busy" errors', () => {
    expect(isRetryableError('device is busy')).toBe(true);
  });

  it('returns true for "device is in use" errors', () => {
    expect(isRetryableError('Device is in use. Close applications')).toBe(true);
  });

  it('returns false for non-retryable errors', () => {
    expect(isRetryableError('Device not found at /Volumes/iPod')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isRetryableError(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isRetryableError('')).toBe(false);
  });
});

describe('ejectWithRetry', () => {
  it('succeeds on first attempt', async () => {
    const manager = createMockManager([{ success: true, device: '/Volumes/iPod', forced: false }]);

    const result = await ejectWithRetry(manager, '/Volumes/iPod', {
      retryDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(manager.ejectCallCount).toBe(1);
  });

  it('retries on retryable error and succeeds', async () => {
    const manager = createMockManager([
      {
        success: false,
        device: '/Volumes/iPod',
        error: 'Volume TERAPOD on disk5s2 failed to unmount: dissented by PID 377',
      },
      { success: true, device: '/Volumes/iPod', forced: false },
    ]);

    const result = await ejectWithRetry(manager, '/Volumes/iPod', {
      retryDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(manager.ejectCallCount).toBe(2);
  });

  it('fails after max attempts exhausted', async () => {
    const busyError: EjectResult = {
      success: false,
      device: '/Volumes/iPod',
      error: 'failed to unmount: dissented by PID 377',
    };
    const manager = createMockManager([busyError, busyError, busyError]);

    const result = await ejectWithRetry(manager, '/Volumes/iPod', {
      maxAttempts: 3,
      retryDelayMs: 10,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(manager.ejectCallCount).toBe(3);
    expect(result.error).toContain('dissented');
  });

  it('does not retry non-retryable errors', async () => {
    const manager = createMockManager([
      {
        success: false,
        device: '/Volumes/iPod',
        error: 'Device not found at /Volumes/iPod',
      },
    ]);

    const result = await ejectWithRetry(manager, '/Volumes/iPod', {
      maxAttempts: 3,
      retryDelayMs: 10,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(manager.ejectCallCount).toBe(1);
  });

  it('force mode bypasses retry', async () => {
    const manager = createMockManager([{ success: true, device: '/Volumes/iPod', forced: true }]);

    const result = await ejectWithRetry(manager, '/Volumes/iPod', {
      force: true,
      retryDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.forced).toBe(true);
    expect(manager.ejectCallCount).toBe(1);
  });

  it('emits correct progress events on first-try success', async () => {
    const manager = createMockManager([{ success: true, device: '/Volumes/iPod', forced: false }]);

    const events: EjectProgressEvent[] = [];
    await ejectWithRetry(manager, '/Volumes/iPod', {
      retryDelayMs: 10,
      onProgress: (event) => events.push(event),
    });

    expect(events).toEqual([
      { phase: 'sync', message: 'Syncing filesystem...' },
      { phase: 'eject', attempt: 1, maxAttempts: 3, message: 'Ejecting iPod...' },
      { phase: 'success', message: 'iPod ejected. Safe to disconnect.', forced: false },
    ]);
  });

  it('emits correct progress events on retry then success', async () => {
    const manager = createMockManager([
      {
        success: false,
        device: '/Volumes/iPod',
        error: 'resource busy',
      },
      { success: true, device: '/Volumes/iPod', forced: false },
    ]);

    const events: EjectProgressEvent[] = [];
    await ejectWithRetry(manager, '/Volumes/iPod', {
      maxAttempts: 3,
      retryDelayMs: 10,
      onProgress: (event) => events.push(event),
    });

    expect(events.length).toBe(5);
    expect(events[0]).toEqual({ phase: 'sync', message: 'Syncing filesystem...' });
    expect(events[1]).toEqual({
      phase: 'eject',
      attempt: 1,
      maxAttempts: 3,
      message: 'Ejecting iPod...',
    });
    expect(events[2]!.phase).toBe('waiting');
    expect(events[3]).toEqual({
      phase: 'eject',
      attempt: 2,
      maxAttempts: 3,
      message: 'Retrying eject (attempt 2/3)...',
    });
    expect(events[4]).toEqual({
      phase: 'success',
      message: 'iPod ejected. Safe to disconnect.',
      forced: false,
    });
  });

  it('emits failed event when all retries exhausted', async () => {
    const manager = createMockManager([
      { success: false, device: '/Volumes/iPod', error: 'resource busy' },
      { success: false, device: '/Volumes/iPod', error: 'resource busy' },
    ]);

    const events: EjectProgressEvent[] = [];
    await ejectWithRetry(manager, '/Volumes/iPod', {
      maxAttempts: 2,
      retryDelayMs: 10,
      onProgress: (event) => events.push(event),
    });

    const lastEvent = events[events.length - 1]!;
    expect(lastEvent.phase).toBe('failed');
  });

  it('emits force eject progress events', async () => {
    const manager = createMockManager([{ success: true, device: '/Volumes/iPod', forced: true }]);

    const events: EjectProgressEvent[] = [];
    await ejectWithRetry(manager, '/Volumes/iPod', {
      force: true,
      retryDelayMs: 10,
      onProgress: (event) => events.push(event),
    });

    expect(events).toEqual([
      { phase: 'sync', message: 'Syncing filesystem...' },
      { phase: 'eject', attempt: 1, maxAttempts: 1, message: 'Force ejecting iPod...' },
      { phase: 'success', message: 'iPod ejected. Safe to disconnect.', forced: true },
    ]);
  });

  it('uses custom deviceLabel in progress messages', async () => {
    const manager = createMockManager([{ success: true, device: '/mnt/player', forced: false }]);

    const events: EjectProgressEvent[] = [];
    await ejectWithRetry(manager, '/mnt/player', {
      retryDelayMs: 10,
      deviceLabel: 'Echo Mini',
      onProgress: (event) => events.push(event),
    });

    expect(events).toEqual([
      { phase: 'sync', message: 'Syncing filesystem...' },
      { phase: 'eject', attempt: 1, maxAttempts: 3, message: 'Ejecting Echo Mini...' },
      { phase: 'success', message: 'Echo Mini ejected. Safe to disconnect.', forced: false },
    ]);
  });

  it('uses custom deviceLabel in force eject messages', async () => {
    const manager = createMockManager([{ success: true, device: '/mnt/player', forced: true }]);

    const events: EjectProgressEvent[] = [];
    await ejectWithRetry(manager, '/mnt/player', {
      force: true,
      retryDelayMs: 10,
      deviceLabel: 'Echo Mini',
      onProgress: (event) => events.push(event),
    });

    expect(events).toEqual([
      { phase: 'sync', message: 'Syncing filesystem...' },
      { phase: 'eject', attempt: 1, maxAttempts: 1, message: 'Force ejecting Echo Mini...' },
      { phase: 'success', message: 'Echo Mini ejected. Safe to disconnect.', forced: true },
    ]);
  });

  it('defaults deviceLabel to iPod when not specified', async () => {
    const manager = createMockManager([{ success: true, device: '/Volumes/iPod', forced: false }]);

    const events: EjectProgressEvent[] = [];
    await ejectWithRetry(manager, '/Volumes/iPod', {
      retryDelayMs: 10,
      onProgress: (event) => events.push(event),
    });

    expect(events[1]).toEqual({
      phase: 'eject',
      attempt: 1,
      maxAttempts: 3,
      message: 'Ejecting iPod...',
    });
    expect(events[2]).toEqual({
      phase: 'success',
      message: 'iPod ejected. Safe to disconnect.',
      forced: false,
    });
  });

  it('uses default maxAttempts of 3', async () => {
    const busyError: EjectResult = {
      success: false,
      device: '/Volumes/iPod',
      error: 'resource busy',
    };
    const manager = createMockManager([busyError, busyError, busyError]);

    const result = await ejectWithRetry(manager, '/Volumes/iPod', {
      retryDelayMs: 10,
    });

    expect(result.attempts).toBe(3);
    expect(manager.ejectCallCount).toBe(3);
  });

  it('ejects additional mount points after primary succeeds', async () => {
    const manager = createMockManager([
      { success: true, device: '/Volumes/Echo SD', forced: false },
      { success: true, device: '/Volumes/ECHO MINI', forced: false },
    ]);

    const events: EjectProgressEvent[] = [];
    const result = await ejectWithRetry(manager, '/Volumes/Echo SD', {
      retryDelayMs: 10,
      deviceLabel: 'Echo Mini',
      additionalMountPoints: ['/Volumes/ECHO MINI'],
      onProgress: (event) => events.push(event),
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    // Primary + 1 sibling = 2 eject calls
    expect(manager.ejectCallCount).toBe(2);
    expect(manager.ejectCalls).toEqual(['/Volumes/Echo SD', '/Volumes/ECHO MINI']);

    // Should have an eject-sibling event before success
    const siblingEvent = events.find((e) => e.phase === 'eject-sibling');
    expect(siblingEvent).toBeDefined();
    expect(siblingEvent).toEqual({
      phase: 'eject-sibling',
      mountPoint: '/Volumes/ECHO MINI',
      message: 'Ejecting sibling volume /Volumes/ECHO MINI...',
    });

    // Success should come after sibling eject
    const successIdx = events.findIndex((e) => e.phase === 'success');
    const siblingIdx = events.findIndex((e) => e.phase === 'eject-sibling');
    expect(siblingIdx).toBeLessThan(successIdx);
  });

  it('ejects multiple siblings in order', async () => {
    const manager = createMockManager([
      { success: true, device: '/Volumes/Main', forced: false },
      { success: true, device: '/Volumes/Sibling1', forced: false },
      { success: true, device: '/Volumes/Sibling2', forced: false },
    ]);

    await ejectWithRetry(manager, '/Volumes/Main', {
      retryDelayMs: 10,
      additionalMountPoints: ['/Volumes/Sibling1', '/Volumes/Sibling2'],
    });

    expect(manager.ejectCallCount).toBe(3);
    expect(manager.ejectCalls).toEqual(['/Volumes/Main', '/Volumes/Sibling1', '/Volumes/Sibling2']);
  });

  it('does not eject siblings when primary eject fails', async () => {
    const manager = createMockManager([
      { success: false, device: '/Volumes/Echo SD', error: 'Device not found at /Volumes/Echo SD' },
    ]);

    const result = await ejectWithRetry(manager, '/Volumes/Echo SD', {
      retryDelayMs: 10,
      additionalMountPoints: ['/Volumes/ECHO MINI'],
    });

    expect(result.success).toBe(false);
    // Only the primary eject should have been attempted
    expect(manager.ejectCallCount).toBe(1);
    expect(manager.ejectCalls).toEqual(['/Volumes/Echo SD']);
  });

  it('tolerates sibling eject failure gracefully', async () => {
    const manager = createMockManager([
      { success: true, device: '/Volumes/Echo SD', forced: false },
      // Sibling might already be gone (whole USB device detached)
      { success: false, device: '/Volumes/ECHO MINI', error: 'Device not found' },
    ]);

    const result = await ejectWithRetry(manager, '/Volumes/Echo SD', {
      retryDelayMs: 10,
      additionalMountPoints: ['/Volumes/ECHO MINI'],
    });

    // Primary still succeeds even though sibling failed
    expect(result.success).toBe(true);
    expect(manager.ejectCallCount).toBe(2);
  });

  it('ejects siblings in force mode after primary succeeds', async () => {
    const manager = createMockManager([
      { success: true, device: '/Volumes/Echo SD', forced: true },
      { success: true, device: '/Volumes/ECHO MINI', forced: false },
    ]);

    const events: EjectProgressEvent[] = [];
    const result = await ejectWithRetry(manager, '/Volumes/Echo SD', {
      force: true,
      retryDelayMs: 10,
      additionalMountPoints: ['/Volumes/ECHO MINI'],
      onProgress: (event) => events.push(event),
    });

    expect(result.success).toBe(true);
    expect(result.forced).toBe(true);
    expect(manager.ejectCallCount).toBe(2);

    // Sibling event should appear
    const siblingEvent = events.find((e) => e.phase === 'eject-sibling');
    expect(siblingEvent).toBeDefined();
  });

  it('works identically with empty additionalMountPoints', async () => {
    const manager = createMockManager([{ success: true, device: '/Volumes/iPod', forced: false }]);

    const result = await ejectWithRetry(manager, '/Volumes/iPod', {
      retryDelayMs: 10,
      additionalMountPoints: [],
    });

    expect(result.success).toBe(true);
    expect(manager.ejectCallCount).toBe(1);
  });
});
