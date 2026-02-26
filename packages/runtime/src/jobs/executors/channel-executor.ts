import { ChannelState, type FiberRpcClient } from '@fiber-pay/sdk';
import { sleep } from '../../utils/async.js';
import { classifyRpcError } from '../error-classifier.js';
import { applyRetryOrFail, transitionJobState } from '../executor-utils.js';
import { channelStateMachine } from '../state-machine.js';
import type { ChannelJob, ClassifiedError, RetryPolicy } from '../types.js';

const DEFAULT_POLL_INTERVAL = 2_000;

export async function* runChannelJob(
  job: ChannelJob,
  rpc: FiberRpcClient,
  policy: RetryPolicy,
  signal: AbortSignal,
): AsyncGenerator<ChannelJob> {
  let current = { ...job };
  const resumedFromRetry = job.state === 'waiting_retry';

  if (current.state === 'queued') {
    current = transitionJobState(current, channelStateMachine, 'send_issued');
    yield current;
  }

  if (current.state === 'waiting_retry') {
    const delay = current.nextRetryAt ? Math.max(0, current.nextRetryAt - Date.now()) : 0;
    if (delay > 0) {
      await sleep(delay, signal);
      if (signal.aborted) {
        current = transitionJobState(current, channelStateMachine, 'cancel');
        yield current;
        return;
      }
    }
    current = transitionJobState(current, channelStateMachine, 'retry_delay_elapsed', {
      patch: { nextRetryAt: undefined },
    });
    yield current;
  }

  try {
    const pollIntervalMs = current.params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;

    if (current.params.action === 'open') {
      if (!current.params.openChannelParams) {
        throw new Error('Channel open job requires openChannelParams');
      }

      const targetPeerId = current.params.peerId ?? current.params.openChannelParams.peer_id;
      let temporaryChannelId = current.result?.temporaryChannelId;

      if (resumedFromRetry) {
        const existing = await findTargetChannel(rpc, targetPeerId, current.params.channelId);
        if (existing && !isClosed(existing.state.state_name)) {
          current = transitionJobState(current, channelStateMachine, 'channel_opening', {
            patch: {
              result: {
                temporaryChannelId,
                channelId: existing.channel_id,
                state: existing.state.state_name,
              },
            },
          });
          yield current;
        } else {
          const opened = await rpc.openChannel(current.params.openChannelParams);
          temporaryChannelId = opened.temporary_channel_id;
          current = transitionJobState(current, channelStateMachine, 'channel_opening', {
            patch: {
              result: {
                temporaryChannelId,
                state: 'OPENING',
              },
            },
          });
          yield current;
        }
      } else {
        const opened = await rpc.openChannel(current.params.openChannelParams);
        temporaryChannelId = opened.temporary_channel_id;
        current = transitionJobState(current, channelStateMachine, 'channel_opening', {
          patch: {
            result: {
              temporaryChannelId,
              state: 'OPENING',
            },
          },
        });
        yield current;
      }

      if (!current.params.waitForReady) {
        current = transitionJobState(current, channelStateMachine, 'payment_success');
        yield current;
        return;
      }

      while (true) {
        if (signal.aborted) {
          current = transitionJobState(current, channelStateMachine, 'cancel');
          yield current;
          return;
        }

        const channels = await rpc.listChannels({
          peer_id: targetPeerId,
          include_closed: true,
        });

        const candidates = channels.channels.filter((channel) => {
          if (current.params.channelId && channel.channel_id !== current.params.channelId)
            return false;
          return channel.peer_id === targetPeerId;
        });

        const readyMatch = candidates.find(
          (channel) => String(channel.state.state_name).toUpperCase() === 'CHANNEL_READY',
        );

        const activeMatch = candidates.find((channel) => !isClosed(channel.state.state_name));

        const closedMatch =
          current.params.channelId && !activeMatch && candidates.length > 0
            ? candidates.find((channel) => isTerminalClosed(channel.state.state_name))
            : undefined;

        if (readyMatch) {
          current = transitionJobState(current, channelStateMachine, 'channel_ready', {
            patch: {
              result: {
                temporaryChannelId,
                channelId: readyMatch.channel_id,
                state: readyMatch.state.state_name,
              },
            },
          });
          yield current;

          current = transitionJobState(current, channelStateMachine, 'payment_success');
          yield current;
          return;
        }

        if (closedMatch) {
          current = transitionJobState(current, channelStateMachine, 'channel_closed', {
            patch: {
              result: {
                temporaryChannelId,
                channelId: closedMatch.channel_id,
                state: closedMatch.state.state_name,
              },
            },
          });
          yield current;
          current = transitionJobState(current, channelStateMachine, 'payment_failed_permanent');
          yield current;
          return;
        }

        current = transitionJobState(current, channelStateMachine, 'channel_opening');
        yield current;
        await sleep(pollIntervalMs, signal);
      }
    }

    if (current.params.action === 'shutdown') {
      const shutdownParams = current.params.shutdownChannelParams;
      if (!shutdownParams) {
        throw new Error('Channel shutdown job requires shutdownChannelParams');
      }

      await rpc.shutdownChannel(shutdownParams);
      current = transitionJobState(current, channelStateMachine, 'channel_closing', {
        patch: {
          result: {
            channelId: shutdownParams.channel_id,
            state: 'SHUTTING_DOWN',
          },
        },
      });
      yield current;

      if (!current.params.waitForClosed) {
        current = transitionJobState(current, channelStateMachine, 'payment_success');
        yield current;
        return;
      }

      while (true) {
        if (signal.aborted) {
          current = transitionJobState(current, channelStateMachine, 'cancel');
          yield current;
          return;
        }

        const channels = await rpc.listChannels({ include_closed: true });
        const match = channels.channels.find(
          (channel) => channel.channel_id === shutdownParams.channel_id,
        );

        if (!match || isTerminalClosed(String(match.state.state_name))) {
          current = transitionJobState(current, channelStateMachine, 'channel_closed', {
            patch: {
              result: {
                channelId: shutdownParams.channel_id,
                state: 'CLOSED',
              },
            },
          });
          yield current;
          current = transitionJobState(current, channelStateMachine, 'payment_success');
          yield current;
          return;
        }

        await sleep(pollIntervalMs, signal);
      }
    }

    if (current.params.action === 'accept') {
      if (!current.params.acceptChannelParams) {
        throw new Error('Channel accept job requires acceptChannelParams');
      }

      const accepted = await rpc.acceptChannel(current.params.acceptChannelParams);
      current = transitionJobState(current, channelStateMachine, 'channel_accepting', {
        patch: {
          result: {
            acceptedChannelId: accepted.channel_id,
            channelId: accepted.channel_id,
            state: 'ACCEPTED',
          },
        },
      });
      yield current;

      current = transitionJobState(current, channelStateMachine, 'payment_success');
      yield current;
      return;
    }

    if (current.params.action === 'abandon') {
      if (!current.params.abandonChannelParams) {
        throw new Error('Channel abandon job requires abandonChannelParams');
      }

      await rpc.abandonChannel(current.params.abandonChannelParams);
      current = transitionJobState(current, channelStateMachine, 'channel_abandoning', {
        patch: {
          result: {
            channelId: current.params.abandonChannelParams.channel_id,
            state: 'ABANDONED',
          },
        },
      });
      yield current;

      current = transitionJobState(current, channelStateMachine, 'payment_success');
      yield current;
      return;
    }

    if (current.params.action === 'update') {
      if (!current.params.updateChannelParams) {
        throw new Error('Channel update job requires updateChannelParams');
      }

      await rpc.updateChannel(current.params.updateChannelParams);
      current = transitionJobState(current, channelStateMachine, 'channel_updating', {
        patch: {
          result: {
            channelId: current.params.updateChannelParams.channel_id,
            state: 'UPDATED',
          },
        },
      });
      yield current;

      current = transitionJobState(current, channelStateMachine, 'payment_success');
      yield current;
      return;
    }

    throw new Error(
      `Unsupported channel action: ${(current.params as { action?: string }).action}`,
    );
  } catch (error) {
    const classified = classifyChannelError(error);
    current = applyRetryOrFail(current, classified, policy, {
      machine: channelStateMachine,
      retryEvent: 'payment_failed_retryable',
      failEvent: 'payment_failed_permanent',
    });
    yield current;
  }
}

function classifyChannelError(error: unknown): ClassifiedError {
  const base = classifyRpcError(error);
  if (base.retryable) {
    return base;
  }

  const raw = base.rawError ?? base.message;
  if (
    /channel\s+not\s+found|no\s+channel\s+with\s+.*\s+found|no\s+channel\s+.*\s+found/i.test(
      raw,
    )
  ) {
    return {
      ...base,
      category: 'temporary_failure',
      retryable: true,
      rawError: raw,
    };
  }

  if (/invalid\s+state|negotiatingfunding|cannot\s+.*\s+in\s+.*state/i.test(raw)) {
    return {
      ...base,
      category: 'temporary_failure',
      retryable: true,
      rawError: raw,
    };
  }

  return base;
}

async function findTargetChannel(rpc: FiberRpcClient, peerId: string, channelId?: `0x${string}`) {
  const channels = await rpc.listChannels({
    peer_id: peerId,
    include_closed: true,
  });

  return channels.channels.find((channel) => {
    if (channelId && channel.channel_id !== channelId) return false;
    return channel.peer_id === peerId;
  });
}

function isClosed(stateName: string): boolean {
  return (
    stateName === ChannelState.Closed ||
    stateName === 'CLOSED' ||
    stateName === ChannelState.ShuttingDown ||
    stateName === 'SHUTTING_DOWN'
  );
}

function isTerminalClosed(stateName: string): boolean {
  return stateName === ChannelState.Closed || stateName === 'CLOSED';
}
