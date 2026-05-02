/**
 * Bun test preload — runs once per `bun test` invocation.
 *
 * If an integration test is being run (detected via argv substring), load
 * `integration-preflight.ts` which throws on missing system deps. For unit-only
 * runs, this preload is a no-op so contributors without libgpod/gpod-tool
 * installed can still iterate on unit tests.
 */
const isIntegrationRun = process.argv.some((a) => a.includes('.integration.'));
if (isIntegrationRun) {
  await import('./integration-preflight');
}
