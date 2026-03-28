// ── Interpreted error ─────────────────────────────────────────────────────────

export interface InterpretedError {
  /** Human-readable explanation */
  explanation: string;
  /** The raw/original error message — always preserved */
  rawMessage: string;
  /** Errno code if detected */
  errno?: number;
  /** Errno name if detected (e.g., 'EPROTO') */
  errnoName?: string;
}

// ── Known errno mappings ──────────────────────────────────────────────────────

const ERRNO_EXPLANATIONS: Record<number, string> = {
  1: 'Operation not permitted. You may need elevated privileges.',
  5: 'I/O error. Possible hardware failure or bad cable.',
  13: 'Permission denied. Try running with elevated privileges or check device permissions.',
  16: 'Device is busy. Another process may be using it.',
  19: 'Device not found. It may have been disconnected.',
  28: 'No space left on device.',
  30: 'Read-only file system.',
  71: 'Device communication failed. The device may be uninitialized, have a corrupted filesystem, or have a bad USB connection.',
};

const ERRNO_NAMES: Record<number, string> = {
  1: 'EPERM',
  5: 'EIO',
  13: 'EACCES',
  16: 'EBUSY',
  19: 'ENODEV',
  28: 'ENOSPC',
  30: 'EROFS',
  71: 'EPROTO',
};

const ERRNO_NAME_TO_CODE: Record<string, number> = {
  EPERM: 1,
  EIO: 5,
  EACCES: 13,
  EBUSY: 16,
  ENODEV: 19,
  ENOSPC: 28,
  EROFS: 30,
  EPROTO: 71,
};

const GENERIC_EXPLANATION = 'An unexpected error occurred.';

// ── Parsing helpers ───────────────────────────────────────────────────────────

function lookupErrno(code: number): Pick<InterpretedError, 'explanation' | 'errnoName'> {
  const explanation = ERRNO_EXPLANATIONS[code] ?? GENERIC_EXPLANATION;
  const errnoName = ERRNO_NAMES[code];
  return { explanation, errnoName };
}

function parseErrnoFromString(message: string): { errno?: number; errnoName?: string } {
  // Match patterns like "errno 71", "error 71", "[Errno 13]"
  const numericMatch = message.match(/(?:\[Errno|errno|error)\s+(\d+)/i);
  if (numericMatch) {
    const errno = parseInt(numericMatch[1]!, 10);
    return { errno, errnoName: ERRNO_NAMES[errno] };
  }

  // Match errno symbolic names like "EPROTO", "EACCES"
  const nameMatch = message.match(/\b(EPERM|EIO|EACCES|EBUSY|ENODEV|ENOSPC|EROFS|EPROTO)\b/);
  if (nameMatch) {
    const errnoName = nameMatch[1]!;
    const errno = ERRNO_NAME_TO_CODE[errnoName];
    return { errno, errnoName };
  }

  return {};
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Interpret an OS error (errno) into a human-readable explanation.
 *
 * Handles both Error objects (which may have `.errno` and `.code` properties)
 * and plain strings. The raw error message is always preserved in the result.
 */
export function interpretError(error: Error | string): InterpretedError {
  const rawMessage = typeof error === 'string' ? error : error.message;

  // Try to extract errno from a Node.js Error object
  if (typeof error === 'object') {
    const nodeError = error as NodeJS.ErrnoException;

    // Check numeric errno property first
    if (typeof nodeError.errno === 'number') {
      // Node.js uses negative errno values on some platforms (e.g. -13 for EACCES)
      const code = Math.abs(nodeError.errno);
      const { explanation, errnoName } = lookupErrno(code);
      return {
        explanation,
        rawMessage,
        errno: code,
        errnoName: nodeError.code ?? errnoName,
      };
    }

    // Check string .code property (e.g. 'EACCES')
    if (typeof nodeError.code === 'string') {
      const errno = ERRNO_NAME_TO_CODE[nodeError.code];
      if (errno !== undefined) {
        const { explanation } = lookupErrno(errno);
        return {
          explanation,
          rawMessage,
          errno,
          errnoName: nodeError.code,
        };
      }
    }
  }

  // Fall back to parsing the message string
  const { errno, errnoName } = parseErrnoFromString(rawMessage);
  if (errno !== undefined) {
    const { explanation } = lookupErrno(errno);
    return { explanation, rawMessage, errno, errnoName };
  }

  if (errnoName !== undefined) {
    const code = ERRNO_NAME_TO_CODE[errnoName];
    if (code !== undefined) {
      const { explanation } = lookupErrno(code);
      return { explanation, rawMessage, errno: code, errnoName };
    }
  }

  return { explanation: GENERIC_EXPLANATION, rawMessage };
}
