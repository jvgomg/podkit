/**
 * Public type exports for the podkit CLI.
 *
 * These types describe the JSON output structures produced by CLI commands.
 * They are used by E2E tests and other consumers that parse CLI JSON output.
 */

export type {
  SyncOutput,
  ErrorInfo,
  PlanWarningInfo,
  ExecutionWarningInfo,
  ScanWarningInfo,
  TransformInfo,
  UpdateBreakdown,
  ConflictInfo,
} from './commands/sync.js';
