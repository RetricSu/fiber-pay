import { act, cleanup, renderHook } from '@testing-library/react';
import type { IFiberClient } from '@fiber-pay/sdk/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChannelOpenFlow } from '../src/use-channel-open-flow.js';
import { validUdtScript } from './fixtures/udt.js';

afterEach(() => {
  cleanup();
});

describe('useChannelOpenFlow', () => {
  it('recovers from invalid UDT configuration instead of remaining in the opening state', async () => {
    const openChannel = vi.fn();
    const node = { openChannel } as unknown as IFiberClient;
    const { result } = renderHook(() => useChannelOpenFlow({ node }));

    await act(async () => {
      const opened = await result.current.openChannel({
        pubkey: '0x01',
        fundingAmount: '100',
        externalWallet: false,
        asset: {
          kind: 'udt',
          script: { ...validUdtScript, code_hash: '0x00' },
        },
      });
      expect(opened).toBeNull();
    });

    expect(result.current.isOpening).toBe(false);
    expect(result.current.error).toContain('code_hash');
    expect(openChannel).not.toHaveBeenCalled();
  });
});
