/**
 * Unit tests for the repo-root env file loader. Asserts the two properties the
 * rest of the substrate layer depends on: the file is found from any working
 * directory, and a variable already present in the real environment is never
 * overwritten by it.
 */

import { describe, it, expect } from 'bun:test';

import { parseEnvFile, loadRepoEnvFile, ENV_FILE_NAME } from './env-file.js';
import { repoRoot } from './paths.js';

describe('parseEnvFile', () => {
  it('reads plain assignments', () => {
    expect(parseEnvFile('PODKIT_SUBSTRATE=deviceRemote\n')).toEqual({
      PODKIT_SUBSTRATE: 'deviceRemote',
    });
  });

  it('ignores blank lines and comments', () => {
    const text = [
      '# which substrate',
      '',
      'PODKIT_SUBSTRATE=deviceRemote',
      '   ',
      '#trailing',
    ].join('\n');
    expect(parseEnvFile(text)).toEqual({ PODKIT_SUBSTRATE: 'deviceRemote' });
  });

  it('accepts a leading `export`', () => {
    expect(parseEnvFile('export PODKIT_BUILD_HOST=builderRemote')).toEqual({
      PODKIT_BUILD_HOST: 'builderRemote',
    });
  });

  it('strips one layer of matching quotes', () => {
    expect(parseEnvFile(`A="one"\nB='two'\nC=three`)).toEqual({
      A: 'one',
      B: 'two',
      C: 'three',
    });
  });

  it('keeps a `#` inside an unquoted value', () => {
    // A token secret is opaque. Stripping an inline comment here would corrupt
    // one silently, which is worse than not supporting inline comments.
    expect(parseEnvFile('PODKIT_PVE_TOKEN_SECRET=ab#cd')).toEqual({
      PODKIT_PVE_TOKEN_SECRET: 'ab#cd',
    });
  });

  it('keeps an empty assignment as an empty string', () => {
    expect(parseEnvFile('PODKIT_SUBSTRATE=')).toEqual({ PODKIT_SUBSTRATE: '' });
  });

  it('ignores lines that are not assignments', () => {
    expect(parseEnvFile('not an assignment\n=novalue\n9LEADING=digit')).toEqual({});
  });

  it('lets a later assignment win', () => {
    expect(parseEnvFile('A=first\nA=second')).toEqual({ A: 'second' });
  });
});

describe('loadRepoEnvFile', () => {
  const FILE = 'PODKIT_SUBSTRATE=deviceRemote\nPODKIT_BUILD_HOST=builderRemote\n';

  it('materialises every absent key and reports which it set', () => {
    const env: Record<string, string | undefined> = {};
    const applied = loadRepoEnvFile({ env, readFile: () => FILE });
    expect(env['PODKIT_SUBSTRATE']).toBe('deviceRemote');
    expect(env['PODKIT_BUILD_HOST']).toBe('builderRemote');
    expect([...applied].sort()).toEqual(['PODKIT_BUILD_HOST', 'PODKIT_SUBSTRATE']);
  });

  it('never overwrites a variable the real environment already carries', () => {
    // CI exports the selection directly and has no dotfile. A loader that won
    // over the exported value would retarget the run away from what CI asked
    // for, which is the same silent-retarget failure it exists to prevent.
    const env: Record<string, string | undefined> = { PODKIT_SUBSTRATE: 'device' };
    const applied = loadRepoEnvFile({ env, readFile: () => FILE });
    expect(env['PODKIT_SUBSTRATE']).toBe('device');
    expect(applied).toEqual(['PODKIT_BUILD_HOST']);
  });

  it('treats a key set to the empty string as already present', () => {
    const env: Record<string, string | undefined> = { PODKIT_SUBSTRATE: '' };
    loadRepoEnvFile({ env, readFile: () => FILE });
    expect(env['PODKIT_SUBSTRATE']).toBe('');
  });

  it('is a no-op when there is no env file', () => {
    const env: Record<string, string | undefined> = {};
    expect(loadRepoEnvFile({ env, readFile: () => null })).toEqual([]);
    expect(env).toEqual({});
  });

  it('reads the repo root rather than the working directory', () => {
    let asked = '';
    loadRepoEnvFile({
      env: {},
      readFile: (file) => {
        asked = file;
        return null;
      },
    });
    expect(asked).toBe(`${repoRoot()}/${ENV_FILE_NAME}`);
  });
});
