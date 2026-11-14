import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { FIBER_SCRIPTS_BY_NETWORK } from '@fiber-pay/sdk';
import { getConfigTemplate } from '../src/lib/config-templates.js';

describe('config templates', () => {
  it.each(['testnet', 'mainnet'] as const)('uses shared contract deployments for %s', (network) => {
    const template = getConfigTemplate(network);
    const document = parse(template, { schema: 'failsafe' });

    expect(document.fiber.scripts).toEqual(FIBER_SCRIPTS_BY_NETWORK[network]);
    for (const script of FIBER_SCRIPTS_BY_NETWORK[network]) {
      expect(template).toContain(`"code_hash": "${script.script.code_hash}"`);
    }
  });
});
