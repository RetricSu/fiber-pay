import type { ClassifiedError, ErrorCategory } from './types.js';

// Fiber node error strings seen in `failed_error` field of PaymentInfo.
// These are best-effort matches — extend as real failure messages are observed.
const PATTERNS: Array<{ pattern: RegExp; category: ErrorCategory; retryable: boolean }> = [
  // Routing / topology
  { pattern: /no path found|no route|route not found/i,          category: 'no_route',             retryable: true  },
  { pattern: /no outgoing channel|no available channel/i,        category: 'no_route',             retryable: true  },
  // Liquidity
  { pattern: /insufficient (balance|capacity|funds)/i,           category: 'insufficient_balance', retryable: false },
  { pattern: /amount.*too large|exceeds.*capacity/i,             category: 'amount_too_large',     retryable: false },
  // Invoice lifecycle
  { pattern: /invoice.*expir|expir.*invoice/i,                   category: 'invoice_expired',      retryable: false },
  { pattern: /invoice.*cancel|cancel.*invoice/i,                 category: 'invoice_cancelled',    retryable: false },
  { pattern: /payment hash.*exist|payment_hash.*exist|duplicated payment hash/i, category: 'invalid_payment', retryable: false },
  // Peer / connectivity
  { pattern: /peer.*offline|peer.*unreachable|peer.*disconnect/i, category: 'peer_offline',        retryable: true  },
  { pattern: /connection.*refused|connection.*reset/i,           category: 'peer_offline',         retryable: true  },
  { pattern: /fetch failed/i,                                    category: 'peer_offline',         retryable: true  },
  { pattern: /peer.*feature not found|waiting for peer to send init message/i, category: 'peer_offline', retryable: true },
  { pattern: /channel.*already.*exist|duplicat(e|ed).*channel/i, category: 'temporary_failure',    retryable: true  },
  // Timeout
  { pattern: /timeout|timed out/i,                               category: 'timeout',              retryable: true  },
  // Payment validity
  { pattern: /invalid.*invoice|malformed.*invoice/i,             category: 'invalid_payment',      retryable: false },
  { pattern: /payment.*hash.*mismatch|preimage.*invalid/i,       category: 'invalid_payment',      retryable: false },
  // Generic temporary
  { pattern: /temporary.*failure|try again|retry/i,              category: 'temporary_failure',    retryable: true  },
];

/**
 * Classify an RPC / job failure into a structured error.
 *
 * `failedError` is the raw `failed_error` string from Fiber's `get_payment` response.
 * `error` is any caught JS exception.
 */
export function classifyRpcError(
  error: unknown,
  failedError?: string,
): ClassifiedError {
  // Prefer Fiber's own error string since it is the most authoritative
  const raw = failedError ?? (error instanceof Error ? error.message : String(error));

  for (const { pattern, category, retryable } of PATTERNS) {
    if (pattern.test(raw)) {
      return { category, retryable, message: raw, rawError: raw };
    }
  }

  return {
    category: 'unknown',
    retryable: false, // safe default: don't retry unknowns
    message: raw,
    rawError: raw,
  };
}
