const CKB_TX_KEY_TO_CAMEL: Record<string, string> = {
  cell_deps: 'cellDeps',
  header_deps: 'headerDeps',
  outputs_data: 'outputsData',
  out_point: 'outPoint',
  dep_type: 'depType',
  previous_output: 'previousOutput',
  tx_hash: 'txHash',
  code_hash: 'codeHash',
  hash_type: 'hashType',
};

const CKB_TX_KEY_TO_SNAKE: Record<string, string> = Object.fromEntries(
  Object.entries(CKB_TX_KEY_TO_CAMEL).map(([snake, camel]) => [camel, snake]),
);

type NormalizeDirection = 'to-camel' | 'to-snake';

function normalizeDepType(value: unknown, direction: NormalizeDirection): unknown {
  if (direction === 'to-camel' && value === 'dep_group') {
    return 'depGroup';
  }
  if (direction === 'to-snake' && value === 'depGroup') {
    return 'dep_group';
  }
  return value;
}

function normalizeCkbTransactionByDirection(
  value: unknown,
  direction: NormalizeDirection,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCkbTransactionByDirection(item, direction));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const map = direction === 'to-camel' ? CKB_TX_KEY_TO_CAMEL : CKB_TX_KEY_TO_SNAKE;
  const input = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(input)) {
    const mappedKey = map[key] ?? key;
    let mappedValue = normalizeCkbTransactionByDirection(item, direction);

    if (mappedKey === 'dep_type' || mappedKey === 'depType') {
      mappedValue = normalizeDepType(mappedValue, direction);
    }

    next[mappedKey] = mappedValue;
  }

  return next;
}

/**
 * Normalize a CKB tx object from Fiber RPC shape (snake_case) to CCC shape (camelCase).
 */
export function normalizeCkbTransactionForCcc<T>(value: T): T {
  return normalizeCkbTransactionByDirection(value, 'to-camel') as T;
}

/**
 * Normalize a CKB tx object from CCC shape (camelCase) to Fiber RPC shape (snake_case).
 */
export function normalizeCkbTransactionForRpc<T>(value: T): T {
  return normalizeCkbTransactionByDirection(value, 'to-snake') as T;
}
