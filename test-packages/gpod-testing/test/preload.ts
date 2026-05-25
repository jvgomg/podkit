const isIntegrationRun = process.argv.some((a) => a.includes('.integration.'));
if (isIntegrationRun) {
  await import('./integration-preflight');
}
