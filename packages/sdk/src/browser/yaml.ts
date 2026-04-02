/**
 * Simple YAML serializer (browser-compatible)
 * Extracted from @fiber-pay/node for use in browser environments.
 * Only the stringify function is needed for config generation.
 */

export function stringify(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);

  if (obj === null || obj === undefined) {
    return 'null';
  }

  if (typeof obj === 'string') {
    // Quote strings that need it
    if (
      obj.includes(':') ||
      obj.includes('#') ||
      obj.includes('\n') ||
      obj.startsWith(' ') ||
      obj.endsWith(' ') ||
      obj === '' ||
      obj === 'true' ||
      obj === 'false' ||
      !Number.isNaN(Number(obj))
    ) {
      return JSON.stringify(obj);
    }
    return obj;
  }

  if (typeof obj === 'number' || typeof obj === 'boolean' || typeof obj === 'bigint') {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return '[]';
    }
    return obj
      .map((item) => {
        const value = stringify(item, indent + 1);
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          // Multi-line object in array
          const lines = value.split('\n');
          return `${spaces}- ${lines[0]}\n${lines
            .slice(1)
            .map((l) => `${spaces}  ${l}`)
            .join('\n')}`;
        }
        return `${spaces}- ${value}`;
      })
      .join('\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) {
      return '{}';
    }
    return entries
      .map(([key, value]) => {
        const valueStr = stringify(value, indent + 1);
        const safeKey = stringify(key);
        if (
          typeof value === 'object' &&
          value !== null &&
          !(Array.isArray(value) && value.length === 0) &&
          !(typeof value === 'object' && Object.keys(value).length === 0)
        ) {
          return `${spaces}${safeKey}:\n${valueStr}`;
        }
        return `${spaces}${safeKey}: ${valueStr}`;
      })
      .join('\n');
  }

  return String(obj);
}
