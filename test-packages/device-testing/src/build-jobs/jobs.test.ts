/**
 * Unit tests for the build-job table.
 *
 * The table is data, so these assert the properties a reader cannot check by
 * eye across five entries: that every declared job exists, that its staging
 * directory is declared on every build host that could run it, and that the
 * two things the old shell scripts most easily got wrong — which job prunes
 * `prebuilds/` and which job's artifacts carry the `-musl` suffix — still hold.
 */

import { describe, expect, it } from 'bun:test';

import { BUILD_JOB_IDS, repoRoot, stagingDestForJob } from '@podkit/substrate';

import { getBuildJob, listBuildJobs, type BuildJobContext } from './jobs.js';

const ctx = (overrides: Partial<BuildJobContext> = {}): BuildJobContext => ({
  arch: 'x64',
  stageDir: '/var/tmp/podkit-build/x',
  cacheDir: '/var/cache/podkit-build',
  containerised: false,
  ...overrides,
});

describe('the build-job table', () => {
  it('declares exactly the jobs the staging registry knows about', () => {
    expect(
      listBuildJobs()
        .map((job) => job.id)
        .sort()
    ).toEqual([...BUILD_JOB_IDS].sort());
  });

  it('fails loudly on an unknown id rather than building nothing and succeeding', () => {
    expect(() => getBuildJob('nope')).toThrow(/no build job registered for 'nope'/);
    expect(() => getBuildJob('nope')).toThrow(/Known jobs:/);
  });

  it('has a staging directory on the remote builder for every job', () => {
    for (const job of listBuildJobs()) {
      expect(stagingDestForJob('builderRemote', job.id)).toMatch(/^\//);
    }
  });

  it('names a turbo task that matches its libc', () => {
    for (const job of listBuildJobs()) {
      expect(job.task).toContain('#build:');
      expect(job.task.includes('musl')).toBe(job.libc === 'musl');
    }
  });
});

describe('staging', () => {
  // The rule that has bitten twice: the prebuild jobs PRODUCE the `.node` and
  // want a clean tree; the binary jobs must carry it in, or `compile.sh` has
  // nothing to embed and hard-fails.
  it('prunes prebuilds/ for the jobs that produce it and no others', () => {
    for (const job of listBuildJobs()) {
      const prunes = (job.stageExcludes ?? []).includes('packages/libgpod-node/prebuilds');
      expect(prunes).toBe(job.id.endsWith('Prebuild'));
    }
  });

  it('stages only tools/gpod-tool for the gpod-tool job', () => {
    const root = repoRoot();
    expect(getBuildJob('glibcGpodTool').stageSrc(root)).toBe(`${root}/tools/gpod-tool`);
    for (const job of listBuildJobs()) {
      if (job.id === 'glibcGpodTool') continue;
      expect(job.stageSrc(root)).toBe(root);
    }
  });
});

describe('artifacts', () => {
  it('suffixes every musl artifact and no glibc one', () => {
    for (const job of listBuildJobs()) {
      for (const artifact of job.artifacts(ctx())) {
        const target = artifact.kind === 'file' ? artifact.hostPath : artifact.hostDir;
        expect(/-musl(\/|$)/.test(target)).toBe(job.libc === 'musl');
      }
    }
  });

  it('checks the ELF header of every executable it collects', () => {
    for (const job of listBuildJobs()) {
      for (const artifact of job.artifacts(ctx())) {
        if (artifact.kind === 'file') expect(artifact.assertArch).toBe(true);
      }
    }
  });

  it('writes every artifact inside the repo', () => {
    for (const job of listBuildJobs()) {
      for (const artifact of job.artifacts(ctx())) {
        const target = artifact.kind === 'file' ? artifact.hostPath : artifact.hostDir;
        expect(target.startsWith(`${repoRoot()}/`)).toBe(true);
      }
    }
  });

  it('names the prebuild directory the arch it was built for', () => {
    const artifacts = getBuildJob('glibcPrebuild').artifacts(ctx({ arch: 'arm64' }));
    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0]!;
    expect(artifact.kind).toBe('dir');
    expect(artifact.guestRel).toBe('packages/libgpod-node/prebuilds/linux-arm64');
  });
});

describe('guest scripts', () => {
  it('put the static-dep and prebuild caches OUTSIDE the staged tree', () => {
    // A stage is `rsync --delete`. A cache inside it is a cache rebuilt from
    // cold on every run, which is the expensive part of a build host's life.
    for (const job of listBuildJobs()) {
      const script = job.script(ctx());
      if (!script.includes('STATIC_DEPS_DIR')) continue;
      expect(script).toContain('/var/cache/podkit-build/static-deps');
      expect(script).not.toContain('/var/tmp/podkit-build/x/');
    }
  });

  it('separates the musl caches from the glibc ones on a shared build host', () => {
    // The remote builder runs both libcs on one box, so an unsuffixed cache
    // would have a musl static-dep closure satisfying a glibc build.
    const glibc = getBuildJob('glibcPrebuild').script(ctx());
    const musl = getBuildJob('muslPrebuild').script(ctx());
    expect(glibc).toContain('static-deps"');
    expect(musl).toContain('static-deps-musl"');
  });

  it('installs with --ignore-scripts so the native build is not raced', () => {
    for (const job of listBuildJobs()) {
      const script = job.script(ctx());
      if (!script.includes('bun install')) continue;
      expect(script).toContain('--frozen-lockfile');
      expect(script).toContain('--ignore-scripts');
    }
  });

  it('builds the workspace before compile.sh', () => {
    for (const id of ['glibcBinary', 'muslBinary'] as const) {
      const script = getBuildJob(id).script(ctx());
      expect(script.indexOf('turbo run build')).toBeLessThan(
        script.indexOf('podkit-cli/scripts/compile.sh')
      );
    }
  });

  // The daemon is a poller with no `--version` fast-exit path; running it to
  // "verify" it would hang the build forever.
  it('never executes the daemon binary it just compiled', () => {
    for (const id of ['glibcBinary', 'muslBinary'] as const) {
      const script = getBuildJob(id).script(ctx());
      expect(script).toContain('file packages/podkit-daemon/bin/podkit-daemon');
      expect(script).not.toMatch(/packages\/podkit-daemon\/bin\/podkit-daemon --/);
    }
  });

  it('runs make clean before make, so a stale host binary cannot survive', () => {
    const script = getBuildJob('glibcGpodTool').script(ctx());
    expect(script.indexOf('make clean')).toBeLessThan(script.indexOf('\nmake\n'));
  });
});
