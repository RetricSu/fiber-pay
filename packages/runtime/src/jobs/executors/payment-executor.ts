import type { FiberRpcClient } from '@fiber-pay/sdk';
import { sleep } from '../../utils/async.js';
import { classifyRpcError } from '../error-classifier.js';
import { applyRetryOrFail, transitionJobState } from '../executor-utils.js';
import { paymentStateMachine } from '../state-machine.js';
import type { PaymentJob, RetryPolicy } from '../types.js';

// ─── PaymentExecutor ──────────────────────────────────────────────────────────

/**
 * Drives a single PaymentJob through its full lifecycle.
 *
 * Yields the updated job object on every state transition so the caller
 * (JobManager) can persist + emit events after each change with no extra lookups.
 *
 * The generator terminates when the job reaches a terminal state
 * (succeeded | failed | cancelled).
 */
export async function* runPaymentJob(
  job: PaymentJob,
  rpc: FiberRpcClient,
  policy: RetryPolicy,
  signal: AbortSignal,
): AsyncGenerator<PaymentJob> {
  let current = { ...job };

  while (!paymentStateMachine.isTerminal(current.state)) {
    if (signal.aborted) {
      current = transitionJobState(current, paymentStateMachine, 'cancel');
      yield current;
      return;
    }

    if (current.state === 'queued') {
      current = transitionJobState(current, paymentStateMachine, 'send_issued');
      yield current;
      continue;
    }

    if (current.state === 'waiting_retry') {
      const delay = current.nextRetryAt ? Math.max(0, current.nextRetryAt - Date.now()) : 0;
      if (delay > 0) {
        await sleep(delay, signal);
        if (signal.aborted) {
          current = transitionJobState(current, paymentStateMachine, 'cancel');
          yield current;
          return;
        }
      }
      current = transitionJobState(current, paymentStateMachine, 'retry_delay_elapsed', {
        patch: { nextRetryAt: undefined },
      });
      yield current;
      continue;
    }

    if (current.state === 'executing') {
      // ── Issue the RPC call ──────────────────────────────────────────────────
      let paymentHash: string | undefined;

      try {
        const sendResult = await rpc.sendPayment(current.params.sendPaymentParams);
        paymentHash = sendResult.payment_hash;

        if (sendResult.status === 'Success') {
          current = transitionJobState(current, paymentStateMachine, 'payment_success', {
            patch: {
              result: {
                paymentHash: sendResult.payment_hash,
                status: sendResult.status,
                fee: sendResult.fee,
                failedError: sendResult.failed_error,
              },
            },
          });
          yield current;
          return;
        }

        if (sendResult.status === 'Failed') {
          const classified = classifyRpcError(
            new Error(sendResult.failed_error ?? 'Payment failed'),
            sendResult.failed_error,
          );
          current = applyRetryOrFail(current, classified, policy, {
            failedPatch: {
              result: {
                paymentHash: sendResult.payment_hash,
                status: sendResult.status,
                fee: sendResult.fee,
                failedError: sendResult.failed_error,
              },
            },
            machine: paymentStateMachine,
            retryEvent: 'payment_failed_retryable',
            failEvent: 'payment_failed_permanent',
          });
          yield current;
          continue;
        }

        // Status is 'Created' or 'Inflight' — move to polling state
        // Dry-run payments are never persisted by the node, so polling
        // getPayment would loop forever with "Payment session not found".
        if (current.params.sendPaymentParams.dry_run) {
          current = transitionJobState(current, paymentStateMachine, 'payment_success', {
            patch: {
              result: {
                paymentHash: sendResult.payment_hash,
                status: 'DryRunSuccess',
                fee: sendResult.fee,
              },
            },
          });
          yield current;
          return;
        }

        current = transitionJobState(current, paymentStateMachine, 'payment_inflight');
        if (paymentHash) {
          current = {
            ...current,
            params: {
              ...current.params,
              sendPaymentParams: {
                ...current.params.sendPaymentParams,
                payment_hash: paymentHash as `0x${string}`,
              },
            },
          };
        }
        yield current;
        continue;
      } catch (err) {
        // RPC call itself threw — classify and decide
        const classified = classifyRpcError(err);
        current = applyRetryOrFail(current, classified, policy, {
          machine: paymentStateMachine,
          retryEvent: 'payment_failed_retryable',
          failEvent: 'payment_failed_permanent',
        });
        yield current;
        continue;
      }
    }

    if (current.state === 'inflight') {
      // ── Poll get_payment until terminal ────────────────────────────────────
      const hash = current.params.sendPaymentParams.payment_hash as string | undefined;

      if (!hash) {
        // Shouldn't happen, but fail-safe
        current = transitionJobState(current, paymentStateMachine, 'payment_failed_permanent', {
          patch: {
            error: {
              category: 'unknown',
              retryable: false,
              message: 'No payment_hash in inflight job',
            },
          },
        });
        yield current;
        continue;
      }

      try {
        const pollResult = await rpc.getPayment({ payment_hash: hash as `0x${string}` });

        if (pollResult.status === 'Success') {
          current = transitionJobState(current, paymentStateMachine, 'payment_success', {
            patch: {
              result: {
                paymentHash: pollResult.payment_hash,
                status: pollResult.status,
                fee: pollResult.fee,
                failedError: pollResult.failed_error,
              },
            },
          });
          yield current;
          return;
        }

        if (pollResult.status === 'Failed') {
          const classified = classifyRpcError(
            new Error(pollResult.failed_error ?? 'Payment failed'),
            pollResult.failed_error,
          );
          current = applyRetryOrFail(current, classified, policy, {
            failedPatch: {
              result: {
                paymentHash: pollResult.payment_hash,
                status: pollResult.status,
                fee: pollResult.fee,
                failedError: pollResult.failed_error,
              },
            },
            machine: paymentStateMachine,
            retryEvent: 'payment_failed_retryable',
            failEvent: 'payment_failed_permanent',
          });
          yield current;
          continue;
        }

        // Still in-flight — wait and poll again
        await sleep(POLL_INTERVAL_MS, signal);
        if (signal.aborted) {
          current = transitionJobState(current, paymentStateMachine, 'cancel');
          yield current;
          return;
        }
        // Stay in 'inflight', loop continues
        current = { ...current, updatedAt: Date.now() };
        continue;
      } catch (err) {
        // Transient RPC error while polling — back off briefly and retry
        const classified = classifyRpcError(err);
        current = applyRetryOrFail(current, classified, policy, {
          machine: paymentStateMachine,
          retryEvent: 'payment_failed_retryable',
          failEvent: 'payment_failed_permanent',
        });
        yield current;
        continue;
      }
    }

    // Unknown state — should not happen if state machine is correct
    break;
  }
}

const POLL_INTERVAL_MS = 1_500;
