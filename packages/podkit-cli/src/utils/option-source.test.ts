import { describe, expect, it } from 'bun:test';
import { stripDefaultOptionValues, withCleanOptions } from './option-source.js';

function makeProbe(sources: Record<string, string | undefined>) {
  return {
    getOptionValueSource: (name: string) => sources[name],
  };
}

describe('stripDefaultOptionValues', () => {
  it('drops keys whose source is "default"', () => {
    const cleaned = stripDefaultOptionValues(
      { artwork: true, dryRun: false },
      makeProbe({ artwork: 'default', dryRun: 'cli' })
    );
    expect(cleaned).toEqual({ dryRun: false });
  });

  it('keeps keys whose source is "cli" (user passed `--no-X` → false survives)', () => {
    const cleaned = stripDefaultOptionValues({ artwork: false }, makeProbe({ artwork: 'cli' }));
    expect(cleaned).toEqual({ artwork: false });
  });

  it('drops the synthetic `--no-X` default that Commander injects when the flag is absent', () => {
    // Commander still reports `artwork: true` (source 'default') even when
    // the user did not pass `--no-artwork`. Must not leak through.
    const cleaned = stripDefaultOptionValues({ artwork: true }, makeProbe({ artwork: 'default' }));
    expect(cleaned.artwork).toBeUndefined();
  });

  it('keeps keys whose source is "env" or "config" (user-derived intent)', () => {
    const cleaned = stripDefaultOptionValues(
      { artwork: false, port: 3000 },
      makeProbe({ artwork: 'config', port: 'env' })
    );
    expect(cleaned).toEqual({ artwork: false, port: 3000 });
  });

  it('keeps keys whose source is "implied" (set via Commander `.implies()`)', () => {
    // Commander's `.implies({ otherFlag: value })` sets the implied option's
    // source to `'implied'`. That's user-derived intent (they passed the
    // flag that triggered the implication), so the value must survive
    // stripping — same class as `'cli'`.
    const cleaned = stripDefaultOptionValues({ drink: 'small' }, makeProbe({ drink: 'implied' }));
    expect(cleaned).toEqual({ drink: 'small' });
  });

  it('passes options through unchanged when the probe lacks getOptionValueSource', () => {
    const cleaned = stripDefaultOptionValues({ artwork: true, dryRun: true }, {});
    expect(cleaned).toEqual({ artwork: true, dryRun: true });
  });
});

describe('withCleanOptions', () => {
  it('strips defaults before invoking the inner action', async () => {
    let received: Record<string, unknown> | undefined;
    const wrapped = withCleanOptions(async (options: { artwork?: boolean; force?: boolean }) => {
      received = options;
    });
    await wrapped({ artwork: true, force: true }, makeProbe({ artwork: 'default', force: 'cli' }));
    expect(received).toEqual({ force: true });
  });

  it('forwards the command instance to the inner action', () => {
    let receivedCommand: unknown;
    const wrapped = withCleanOptions((_options: object, command) => {
      receivedCommand = command;
    });
    const probe = makeProbe({});
    wrapped({}, probe);
    expect(receivedCommand).toBe(probe);
  });
});
