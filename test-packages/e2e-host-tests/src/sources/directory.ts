/**
 * Directory test source
 *
 * Uses local test fixtures for E2E testing.
 * This is the default source type that doesn't require Docker.
 */

import { existsSync } from 'node:fs';
import { getFixturesDir } from '../helpers/fixtures.js';
import type { TestSource } from './types.js';

/**
 * Test source using local directory with test fixtures
 */
export class DirectoryTestSource implements TestSource {
  readonly name = 'directory';
  readonly requiresDocker = false;

  private fixturesPath: string;

  constructor() {
    this.fixturesPath = getFixturesDir();
  }

  get sourceUrl(): string {
    return this.fixturesPath;
  }

  get trackCount(): number {
    // The standard audio fixtures have 4 test tracks
    return 4;
  }

  async setup(): Promise<void> {
    // No setup needed for local fixtures
  }

  async teardown(): Promise<void> {
    // No teardown needed for local fixtures
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.fixturesPath);
  }

  getEnv(): Record<string, string> {
    // No special environment variables needed
    return {};
  }
}

/**
 * Create a directory test source
 */
export function createDirectorySource(): DirectoryTestSource {
  return new DirectoryTestSource();
}
