import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeUdtTypeScript } from '@fiber-pay/sdk/browser';
import { FiberPayQuickCard } from '../src/fiber-pay-quick-card.js';
import type { UseFiberNodeResult } from '../src/use-fiber-node.js';
import { validUdtScript } from './fixtures/udt.js';

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
        parseInvoice: vi.fn(async () => ({
          invoice: {
            currency: 'Fibt',
            data: { payment_hash: '0x1', attrs: [] },
          },
        })),
        sendPayment: vi.fn(async () => ({})),
        waitForPayment: vi.fn(async () => ({ status: 'Succeeded' })),
      } as unknown as UseFiberNodeResult['node'],
      nodeInfo: { pubkey: '0x0123456789abcdef0123456789abcdef' } as UseFiberNodeResult['nodeInfo'],
    });

    render(<FiberPayQuickCard fiber={fiber} network="testnet" />);

    expect(screen.getByText(/State:/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Invoice (1 CKB)' })).toBeTruthy();
  });

  it('creates a UDT invoice when asset is UDT', async () => {
    const newInvoice = vi.fn(async () => ({ invoice_address: 'ln-udt' }));
    const sendPayment = vi.fn(async () => ({}));
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: {
        newInvoice,
        parseInvoice: vi.fn(async () => ({
          invoice: {
            currency: 'Fibt',
            data: {
              payment_hash: '0x1',
              attrs: [{ udt_script: serializeUdtTypeScript(validUdtScript) }],
            },
          },
        })),
        sendPayment,
        waitForPayment: vi.fn(async () => ({ status: 'Succeeded' })),
      } as unknown as UseFiberNodeResult['node'],
      nodeInfo: { pubkey: '0x0123456789abcdef0123456789abcdef' } as UseFiberNodeResult['nodeInfo'],
    });

    render(
      <FiberPayQuickCard
        fiber={fiber}
        network="testnet"
        asset={{ kind: 'udt', script: validUdtScript, name: 'MyToken' }}
        invoiceAmount="250"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Create Invoice/i }));

    await waitFor(() => {
      expect(newInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: '0xfa',
          udt_type_script: validUdtScript,
        }),
      );
    });

    // Payment should also forward the UDT asset to sendPayment
    fireEvent.change(screen.getByLabelText('Invoice to pay'), { target: { value: 'ln-udt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }));

    await waitFor(() => {
      expect(sendPayment).toHaveBeenCalledWith({
        invoice: 'ln-udt',
        udt_type_script: validUdtScript,
      });
    });
  });
});
