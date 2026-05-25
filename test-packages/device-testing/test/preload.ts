const isIntegrationRun = process.argv.some((a) => a.includes('.integration.'));
if (isIntegrationRun) {
  // No integration preflight yet — the lima-test-vm runner ships in TASK-321.03+.
}
