import type { FiberNodeButtonI18n } from './types.js';

function applyVariables(template: string, vars?: Record<string, string | number>): string {
  if (!vars) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (full, key: string) => {
    const value = vars[key];
    return value === undefined ? full : String(value);
  });
}

export const defaultFiberNodeButtonI18n: FiberNodeButtonI18n = (_key, fallback, vars) =>
  applyVariables(fallback, vars);
