import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { FIBER_SCRIPTS_BY_NETWORK } from '../src/config/fiber-deployments.js';

describe('Fiber contract deployments', () => {
  it.each(['testnet', 'mainnet'] as const)(
    'matches the upstream fnn v0.10.1 %s config fixture',
    (network) => {
      const fixtureUrl = new URL(`./fixtures/fnn-v0.10.1/${network}.config.yml`, import.meta.url);
      const upstream = parse(readFileSync(fixtureUrl, 'utf8'), { schema: 'failsafe' });

      expect(FIBER_SCRIPTS_BY_NETWORK[network]).toEqual(upstream.fiber.scripts);
    },
  );
});
