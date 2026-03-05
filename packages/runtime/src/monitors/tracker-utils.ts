/**
 * Return true when the RPC error indicates the item permanently does not
 * exist on the node (e.g. "Payment session not found").  Callers should
 * move the tracked item to a terminal state so it stops being polled.
 */
export function isNotFoundError(error: unknown): boolean {
  const haystack = collectErrorText(error);
  return /not found|does not exist|no such/i.test(haystack);
}

/**
 * Determine whether an error thrown during invoice/payment tracking is
 * expected and should be silently skipped (transient connectivity blip).
 * Unexpected errors are re-thrown by callers.
 */
export function isExpectedTrackerError(error: unknown): boolean {
  const haystack = collectErrorText(error);
  return /temporarily unavailable|connection refused|timed out|timeout/i.test(haystack);
}

function collectErrorText(error: unknown): string {
  if (error === null || error === undefined) {
    return '';
  }

  const parts: string[] = [];
  const seen = new Set<unknown>();

  const walk = (value: unknown, depth: number): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (depth > 4) {
      return;
    }

    if (typeof value === 'string') {
      parts.push(value);
      return;
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      parts.push(String(value));
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (value instanceof Error) {
      parts.push(value.message);
      const valueWithData = value as Error & { data?: unknown; cause?: unknown };
      walk(valueWithData.data, depth + 1);
      walk(valueWithData.cause, depth + 1);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, depth + 1);
      }
      return;
    }

    for (const nested of Object.values(value as Record<string, unknown>)) {
      walk(nested, depth + 1);
    }
  };

  walk(error, 0);
  return parts.join(' ');
}
