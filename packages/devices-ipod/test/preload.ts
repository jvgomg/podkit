const isIntegrationRun = process.argv.some((a) => a.includes('.integration.'));
if (isIntegrationRun) {
  // no integration preflight needed for devices-ipod (pure data package)
}
