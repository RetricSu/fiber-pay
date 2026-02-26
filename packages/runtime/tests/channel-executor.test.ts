import { describe, expect, it, vi } from 'vitest';
import { runChannelJob } from '../src/jobs/executors/channel-executor.js';
import { defaultPaymentRetryPolicy } from '../src/jobs/retry-policy.js';
import type { FiberRpcClient } from '@fiber-pay/sdk';
import type { ChannelJob } from '../src/jobs/types.js';

function baseJob(overrides: Partial<ChannelJob> = {}): ChannelJob {
  return {
    id: 'ch-job-1',
    type: 'channel',
    state: 'queued',
    params: {
      action: 'open',
      openChannelParams: { peer_id: 'peer-1', funding_amount: '0x64' },
      waitForReady: true,
      pollIntervalMs: 1,
    },
    retryCount: 0,
    maxRetries: 0,
    idempotencyKey: 'ch-key-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('runChannelJob', () => {
  it('opens channel and succeeds once channel ready is observed', async () => {
    const rpc = {
      openChannel: async () => ({ temporary_channel_id: '0xtmp' }),
      listChannels: async () => ({
        channels: [
          {
            channel_id: '0xchan1',
            is_public: false,
            channel_outpoint: null,
            peer_id: 'peer-1',
            funding_udt_type_script: null,
            state: { state_name: 'CHANNEL_READY' },
            local_balance: '0x0',
            offered_tlc_balance: '0x0',
            remote_balance: '0x0',
            received_tlc_balance: '0x0',
            pending_tlcs: [],
            latest_commitment_transaction_hash: null,
            created_at: '0x0',
            enabled: true,
            tlc_expiry_delta: '0x0',
            tlc_fee_proportional_millionths: '0x0',
            shutdown_transaction_hash: null,
          },
        ],
      }),
    } as unknown as FiberRpcClient;

    const states: string[] = [];
    for await (const updated of runChannelJob(baseJob(), rpc, defaultPaymentRetryPolicy, new AbortController().signal)) {
      states.push(updated.state);
    }

    expect(states).toContain('channel_opening');
    expect(states).toContain('channel_ready');
    expect(states[states.length - 1]).toBe('succeeded');
  });

  it('schedules retry on peer init handshake race error', async () => {
    const rpc = {
      openChannel: async () => {
        throw new Error(
          "Invalid parameter: Peer PeerId(QmFoo)'s feature not found, waiting for peer to send Init message",
        );
      },
      listChannels: async () => ({ channels: [] }),
    } as unknown as FiberRpcClient;

    const updates: ChannelJob[] = [];
    for await (const updated of runChannelJob(
      baseJob({ maxRetries: 2 }),
      rpc,
      defaultPaymentRetryPolicy,
      new AbortController().signal,
    )) {
      updates.push(updated);
    }

    expect(updates[updates.length - 1].state).toBe('waiting_retry');
    expect(updates[updates.length - 1].retryCount).toBe(1);
    expect(updates[updates.length - 1].error?.retryable).toBe(true);
  });

  it('resumes from waiting_retry without calling openChannel when channel already exists', async () => {
    let openCallCount = 0;
    const rpc = {
      openChannel: async () => {
        openCallCount++;
        return { temporary_channel_id: '0xnew' };
      },
      listChannels: async () => ({
        channels: [
          {
            channel_id: '0xchan-existing',
            is_public: false,
            channel_outpoint: null,
            peer_id: 'peer-1',
            funding_udt_type_script: null,
            state: { state_name: 'CHANNEL_READY' },
            local_balance: '0x0',
            offered_tlc_balance: '0x0',
            remote_balance: '0x0',
            received_tlc_balance: '0x0',
            pending_tlcs: [],
            latest_commitment_transaction_hash: null,
            created_at: '0x0',
            enabled: true,
            tlc_expiry_delta: '0x0',
            tlc_fee_proportional_millionths: '0x0',
            shutdown_transaction_hash: null,
          },
        ],
      }),
    } as unknown as FiberRpcClient;

    const states: string[] = [];
    for await (const updated of runChannelJob(
      baseJob({ state: 'waiting_retry', retryCount: 1, nextRetryAt: Date.now() - 1 }),
      rpc,
      defaultPaymentRetryPolicy,
      new AbortController().signal,
    )) {
      states.push(updated.state);
    }

    expect(openCallCount).toBe(0);
    expect(states).toContain('channel_opening');
    expect(states[states.length - 1]).toBe('succeeded');
  });

  it('waits for nextRetryAt before retrying waiting_retry jobs', async () => {
    vi.useFakeTimers();
    try {
      let openCallCount = 0;
      const rpc = {
        openChannel: async () => {
          openCallCount++;
          return { temporary_channel_id: '0xtmp' };
        },
        listChannels: async () => ({
          channels: [
            {
              channel_id: '0xchan1',
              is_public: false,
              channel_outpoint: null,
              peer_id: 'peer-1',
              funding_udt_type_script: null,
              state: { state_name: 'CHANNEL_READY' },
              local_balance: '0x0',
              offered_tlc_balance: '0x0',
              remote_balance: '0x0',
              received_tlc_balance: '0x0',
              pending_tlcs: [],
              latest_commitment_transaction_hash: null,
              created_at: '0x0',
              enabled: true,
              tlc_expiry_delta: '0x0',
              tlc_fee_proportional_millionths: '0x0',
              shutdown_transaction_hash: null,
            },
          ],
        }),
      } as unknown as FiberRpcClient;

      const updates: ChannelJob[] = [];
      const consume = (async () => {
        for await (const updated of runChannelJob(
          baseJob({
            state: 'waiting_retry',
            retryCount: 1,
            nextRetryAt: Date.now() + 1_000,
          }),
          rpc,
          defaultPaymentRetryPolicy,
          new AbortController().signal,
        )) {
          updates.push(updated);
        }
      })();

      await vi.advanceTimersByTimeAsync(999);
      expect(updates).toHaveLength(0);
      expect(openCallCount).toBe(0);

      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      expect(updates[0]?.state).toBe('executing');

      await consume;
      expect(updates[updates.length - 1].state).toBe('succeeded');
      expect(openCallCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not treat shutting_down channel as reusable existing open target', async () => {
    let openCallCount = 0;
    const rpc = {
      openChannel: async () => {
        openCallCount++;
        return { temporary_channel_id: '0xnew' };
      },
      listChannels: async () => ({
        channels: [
          {
            channel_id: '0xchan-shutting-down',
            is_public: false,
            channel_outpoint: null,
            peer_id: 'peer-1',
            funding_udt_type_script: null,
            state: { state_name: 'SHUTTING_DOWN' },
            local_balance: '0x0',
            offered_tlc_balance: '0x0',
            remote_balance: '0x0',
            received_tlc_balance: '0x0',
            pending_tlcs: [],
            latest_commitment_transaction_hash: null,
            created_at: '0x0',
            enabled: true,
            tlc_expiry_delta: '0x0',
            tlc_fee_proportional_millionths: '0x0',
            shutdown_transaction_hash: null,
          },
        ],
      }),
    } as unknown as FiberRpcClient;

    const updates: ChannelJob[] = [];
    for await (const updated of runChannelJob(
      baseJob({ maxRetries: 0, params: { ...baseJob().params, waitForReady: false } }),
      rpc,
      defaultPaymentRetryPolicy,
      new AbortController().signal,
    )) {
      updates.push(updated);
    }

    expect(openCallCount).toBe(1);
    expect(updates[updates.length - 1].state).toBe('succeeded');
  });

  it('prefers ready channel over stale shutting_down candidate for same peer', async () => {
    const rpc = {
      openChannel: async () => ({ temporary_channel_id: '0xtmp' }),
      listChannels: async () => ({
        channels: [
          {
            channel_id: '0xchan-stale',
            is_public: false,
            channel_outpoint: null,
            peer_id: 'peer-1',
            funding_udt_type_script: null,
            state: { state_name: 'SHUTTING_DOWN' },
            local_balance: '0x0',
            offered_tlc_balance: '0x0',
            remote_balance: '0x0',
            received_tlc_balance: '0x0',
            pending_tlcs: [],
            latest_commitment_transaction_hash: null,
            created_at: '0x0',
            enabled: true,
            tlc_expiry_delta: '0x0',
            tlc_fee_proportional_millionths: '0x0',
            shutdown_transaction_hash: null,
          },
          {
            channel_id: '0xchan-ready',
            is_public: false,
            channel_outpoint: null,
            peer_id: 'peer-1',
            funding_udt_type_script: null,
            state: { state_name: 'CHANNEL_READY' },
            local_balance: '0x0',
            offered_tlc_balance: '0x0',
            remote_balance: '0x0',
            received_tlc_balance: '0x0',
            pending_tlcs: [],
            latest_commitment_transaction_hash: null,
            created_at: '0x0',
            enabled: true,
            tlc_expiry_delta: '0x0',
            tlc_fee_proportional_millionths: '0x0',
            shutdown_transaction_hash: null,
          },
        ],
      }),
    } as unknown as FiberRpcClient;

    const updates: ChannelJob[] = [];
    for await (const updated of runChannelJob(
      baseJob(),
      rpc,
      defaultPaymentRetryPolicy,
      new AbortController().signal,
    )) {
      updates.push(updated);
    }

    expect(updates[updates.length - 1].state).toBe('succeeded');
    expect(updates.find((update) => update.state === 'channel_ready')?.result?.channelId).toBe('0xchan-ready');
  });

  it('accept action transitions through channel_accepting to succeeded', async () => {
    const rpc = {
      acceptChannel: async () => ({ channel_id: '0xaccepted' }),
    } as unknown as FiberRpcClient;

    const updates: ChannelJob[] = [];
    for await (const updated of runChannelJob(
      baseJob({
        params: {
          action: 'accept',
          acceptChannelParams: {
            temporary_channel_id: '0xtmp',
            funding_amount: '0x64',
          },
        },
      }),
      rpc,
      defaultPaymentRetryPolicy,
      new AbortController().signal,
    )) {
      updates.push(updated);
    }

    expect(updates.some((update) => update.state === 'channel_accepting')).toBe(true);
    expect(updates[updates.length - 1].state).toBe('succeeded');
    expect(updates.find((update) => update.state === 'channel_accepting')?.result?.channelId).toBe('0xaccepted');
  });

  it('accept action schedules retry when temporary channel id is missing', async () => {
    const rpc = {
      acceptChannel: async () => {
        throw new Error('Invalid parameter: No channel with temp id Hash256(0xdeadbeef) found');
      },
    } as unknown as FiberRpcClient;

    const updates: ChannelJob[] = [];
    for await (const updated of runChannelJob(
      baseJob({
        maxRetries: 2,
        params: {
          action: 'accept',
          acceptChannelParams: {
            temporary_channel_id: '0xdeadbeef',
            funding_amount: '0x64',
          },
        },
      }),
      rpc,
      defaultPaymentRetryPolicy,
      new AbortController().signal,
    )) {
      updates.push(updated);
    }

    expect(updates[updates.length - 1].state).toBe('waiting_retry');
    expect(updates[updates.length - 1].retryCount).toBe(1);
    expect(updates[updates.length - 1].error?.retryable).toBe(true);
    expect(updates[updates.length - 1].error?.message).toContain('No channel with temp id');
  });

  it('schedules retry when channel operation fails due to transient invalid state', async () => {
    const rpc = {
      shutdownChannel: async () => {
        throw new Error(
          'Invalid state: Trying to send shutdown message while in invalid state NegotiatingFunding(NegotiatingFundingFlags(OUR_INIT_SENT))',
        );
      },
    } as unknown as FiberRpcClient;

    const updates: ChannelJob[] = [];
    for await (const updated of runChannelJob(
      baseJob({
        maxRetries: 2,
        params: {
          action: 'shutdown',
          shutdownChannelParams: {
            channel_id: '0xdeadbeef' as `0x${string}`,
            force: false,
          },
          waitForClosed: false,
        },
      }),
      rpc,
      defaultPaymentRetryPolicy,
      new AbortController().signal,
    )) {
      updates.push(updated);
    }

    expect(updates[updates.length - 1].state).toBe('waiting_retry');
    expect(updates[updates.length - 1].retryCount).toBe(1);
    expect(updates[updates.length - 1].error?.retryable).toBe(true);
    expect(updates[updates.length - 1].error?.category).toBe('temporary_failure');
  });

  it('abandon action transitions through channel_abandoning to succeeded', async () => {
    let called = false;
    const rpc = {
      abandonChannel: async () => {
        called = true;
        return null;
      },
    } as unknown as FiberRpcClient;

    const updates: ChannelJob[] = [];
    for await (const updated of runChannelJob(
      baseJob({
        params: {
          action: 'abandon',
          abandonChannelParams: {
            channel_id: '0xchan-abandon',
          },
        },
      }),
      rpc,
      defaultPaymentRetryPolicy,
      new AbortController().signal,
    )) {
      updates.push(updated);
    }

    expect(called).toBe(true);
    expect(updates.some((update) => update.state === 'channel_abandoning')).toBe(true);
    expect(updates[updates.length - 1].state).toBe('succeeded');
  });

  it('update action transitions through channel_updating to succeeded', async () => {
    let called = false;
    const rpc = {
      updateChannel: async () => {
        called = true;
        return null;
      },
    } as unknown as FiberRpcClient;

    const updates: ChannelJob[] = [];
    for await (const updated of runChannelJob(
      baseJob({
        params: {
          action: 'update',
          updateChannelParams: {
            channel_id: '0xchan-update',
            enabled: true,
          },
        },
      }),
      rpc,
      defaultPaymentRetryPolicy,
      new AbortController().signal,
    )) {
      updates.push(updated);
    }

    expect(called).toBe(true);
    expect(updates.some((update) => update.state === 'channel_updating')).toBe(true);
    expect(updates[updates.length - 1].state).toBe('succeeded');
  });
});
