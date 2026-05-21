import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FiberPayQuickCard } from '../src/fiber-pay-quick-card.js';
import type { UseFiberNodeResult } from '../src/use-fiber-node.js';

afterEach(() => {
  cleanup();
});

function createFiberMock(overrides: Partial<UseFiberNodeResult> = {}): UseFiberNodeResult {
  return {
    state: 'idle',
    node: null,
    nodeInfo: null,
    error: null,
    isStarting: false,
    isRunning: false,
    isPasskeySupported: true,
    passkeySupportReason: 'supported',
    passkeyUnavailableReason: null,
    hasPasskeyConfigured: true,
    startWithPassword: vi.fn(async () => {}),
    createPasskeyAndStart: vi.fn(async () => {}),
    startWithPasskey: vi.fn(async () => {}),
    startWithRawKey: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('FiberPayQuickCard', () => {
  it('shows shared-session guidance when an external fiber is disconnected', () => {
    const fiber = createFiberMock();

    render(<FiberPayQuickCard fiber={fiber} network="testnet" />);

    expect(screen.getByText(/Connection required/i)).toBeTruthy();
    expect(screen.queryByLabelText('Node password')).toBeNull();
  });

  it('renders payment actions when shared fiber is connected', () => {
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: {
        newInvoice: vi.fn(async () => ({ invoice_address: 'ln-fake' })),
        parseInvoice: vi.fn(async () => ({ invoice: { data: { payment_hash: '0x1' } } })),
        sendPayment: vi.fn(async () => ({})),
        waitForPayment: vi.fn(async () => ({ status: 'Succeeded' })),
      } as unknown as UseFiberNodeResult['node'],
      nodeInfo: { pubkey: '0x0123456789abcdef0123456789abcdef' } as UseFiberNodeResult['nodeInfo'],
    });

    render(<FiberPayQuickCard fiber={fiber} network="testnet" />);

    expect(screen.getByText(/State:/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Invoice (1 CKB)' })).toBeTruthy();
  });
});
