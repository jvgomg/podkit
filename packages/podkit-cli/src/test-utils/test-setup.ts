import { afterEach } from 'bun:test';

// CLI commands set `process.exitCode` to signal failure. Tests that exercise
// those paths (directly, or via the default `processExitCodeSink`) leave the
// process-global exit code set. Restoring it to the captured initial value
// does NOT work: that value is `undefined`, and since Bun 1.3.14 assigning
// `undefined` no longer clears a previously-set numeric code — so a single
// passing-but-exit-setting test makes the whole `bun test` run exit 1 with
// "0 fail". Reset to 0 after every test so a clean run reports success.
afterEach(() => {
  process.exitCode = 0;
});
