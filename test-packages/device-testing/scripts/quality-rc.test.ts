/**
 * Message-layer tests for `quality:rc`'s non-ready preflight states.
 *
 * The side-effecting glue (artefact download, env assembly, invoking the
 * two-phase body) is validated end-to-end, not here. What we lock down is the
 * user-facing contract for each fail-fast state: an actionable message that
 * names the situation, and — where one exists — surfaces the build run url so
 * the maintainer can jump straight to it. No `gh`, no network, no subprocess.
 */

import { describe, it, expect } from 'bun:test';

import { formatNonReadyMessage } from './quality-rc.js';

describe('formatNonReadyMessage', () => {
  it('no-version-pr explains there is nothing to gate and points to `quality` + a changeset', () => {
    const msg = formatNonReadyMessage({ kind: 'no-version-pr' });
    expect(msg).toContain('No release candidate');
    expect(msg).toContain('Version Packages');
    expect(msg).toContain('bun run quality');
    expect(msg).toContain('bunx changeset');
  });

  it('build-in-progress surfaces the run url and offers --wait', () => {
    const url = 'https://github.com/jvgomg/podkit/actions/runs/123';
    const msg = formatNonReadyMessage({ kind: 'build-in-progress', runId: 123, url });
    expect(msg).toContain('in progress');
    expect(msg).toContain(url);
    expect(msg).toContain('--wait');
  });

  it('build-failed surfaces the run url and says fix the build first', () => {
    const url = 'https://github.com/jvgomg/podkit/actions/runs/456';
    const msg = formatNonReadyMessage({ kind: 'build-failed', runId: 456, url });
    expect(msg).toContain('failed');
    expect(msg).toContain(url);
    expect(msg).toContain('Fix the release-candidate build first');
  });
});
