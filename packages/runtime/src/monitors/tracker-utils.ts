/**
 * Return true when the RPC error indicates the item permanently does not
 * exist on the node (e.g. "Payment session not found").  Callers should
 * move the tracked item to a terminal state so it stops being polled.
 */
export function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|does not exist|no such/i.test(message);
}

/**
 * Determine whether an error thrown during invoice/payment tracking is
 * expected and should be silently skipped (transient connectivity blip).
 * Unexpected errors are re-thrown by callers.
 */
export function isExpectedTrackerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /temporarily unavailable|connection refused|timed out|timeout/i.test(message);
}
