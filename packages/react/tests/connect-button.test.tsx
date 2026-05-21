import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectButton } from '../src/connect-button.js';
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

describe('ConnectButton', () => {
  it('reports a repeated error message only once', async () => {
    const onError = vi.fn();
    const startWithPassword = vi.fn(async () => {
      throw new Error('boom');
    });

    const fiber = createFiberMock({
      error: 'boom',
      startWithPassword,
    });

    render(<ConnectButton fiber={fiber} strategy="password" password="secret" onError={onError} />);

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith('boom');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(startWithPassword).toHaveBeenCalledWith('secret');
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('exposes dropdown state via aria-expanded when connected', () => {
    const fiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: {} as UseFiberNodeResult['node'],
      nodeInfo: { pubkey: '0x0123456789abcdef0123456789abcdef' } as UseFiberNodeResult['nodeInfo'],
    });

    render(<ConnectButton fiber={fiber} strategy="passkey" />);

    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Connection panel' })).toBeTruthy();
  });

  it('emits onConnect and onDisconnect exactly once per transition', async () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();

    const disconnectedFiber = createFiberMock({
      state: 'idle',
      isRunning: false,
      node: null,
      nodeInfo: null,
    });

    const connectedFiber = createFiberMock({
      state: 'running',
      isRunning: true,
      node: {} as UseFiberNodeResult['node'],
      nodeInfo: { pubkey: '0x0123456789abcdef0123456789abcdef' } as UseFiberNodeResult['nodeInfo'],
    });

    const { rerender } = render(
      <ConnectButton
        fiber={disconnectedFiber}
        strategy="passkey"
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />,
    );

    rerender(
      <ConnectButton
        fiber={connectedFiber}
        strategy="passkey"
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />,
    );

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledTimes(1);
    });

    rerender(
      <ConnectButton
        fiber={disconnectedFiber}
        strategy="passkey"
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />,
    );

    await waitFor(() => {
      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });
  });
});
