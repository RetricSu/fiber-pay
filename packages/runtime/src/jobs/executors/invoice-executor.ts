import type { FiberRpcClient } from '@fiber-pay/sdk';
import { sleep } from '../../utils/async.js';
import { classifyRpcError } from '../error-classifier.js';
import { applyRetryOrFail, transitionJobState } from '../executor-utils.js';
import { invoiceStateMachine } from '../state-machine.js';
import type { InvoiceJob, RetryPolicy } from '../types.js';

const DEFAULT_POLL_INTERVAL = 1_500;

export async function* runInvoiceJob(
  job: InvoiceJob,
  rpc: FiberRpcClient,
  policy: RetryPolicy,
  signal: AbortSignal,
): AsyncGenerator<InvoiceJob> {
  let current = { ...job };

  if (current.state === 'queued') {
    current = transitionJobState(current, invoiceStateMachine, 'send_issued');
    yield current;
  }

  if (current.state === 'waiting_retry') {
    const delay = current.nextRetryAt ? Math.max(0, current.nextRetryAt - Date.now()) : 0;
    if (delay > 0) {
      await sleep(delay, signal);
      if (signal.aborted) {
        current = transitionJobState(current, invoiceStateMachine, 'cancel');
        yield current;
        return;
      }
    }
    current = transitionJobState(current, invoiceStateMachine, 'retry_delay_elapsed', {
      patch: { nextRetryAt: undefined },
    });
    yield current;
  }

  try {
    const pollIntervalMs = current.params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;

    if (current.params.action === 'create') {
      if (!current.params.newInvoiceParams) {
        throw new Error('Invoice create job requires newInvoiceParams');
      }
      const created = await rpc.newInvoice(current.params.newInvoiceParams);
      const paymentHash = created.invoice.data.payment_hash;
      const createdStatus = 'Open';

      current = {
        ...current,
        state: 'invoice_created',
        result: {
          paymentHash,
          invoiceAddress: created.invoice_address,
          status: createdStatus,
          invoice: created.invoice,
        },
        updatedAt: Date.now(),
      };
      yield current;

      if (!current.params.waitForTerminal) {
        current = transitionJobState(current, invoiceStateMachine, 'payment_success');
        yield current;
        return;
      }

      // Watch invoice until terminal
      while (true) {
        if (signal.aborted) {
          current = transitionJobState(current, invoiceStateMachine, 'cancel');
          yield current;
          return;
        }

        const invoice = await rpc.getInvoice({ payment_hash: paymentHash });
        if (invoice.status === 'Paid') {
          current = {
            ...current,
            state: 'invoice_settled',
            result: {
              paymentHash,
              invoiceAddress: invoice.invoice_address,
              status: invoice.status,
              invoice: invoice.invoice,
            },
            updatedAt: Date.now(),
          };
          yield current;

          current = transitionJobState(current, invoiceStateMachine, 'payment_success');
          yield current;
          return;
        }

        if (invoice.status === 'Received') {
          current = {
            ...current,
            state: 'invoice_received',
            result: {
              paymentHash,
              invoiceAddress: invoice.invoice_address,
              status: invoice.status,
              invoice: invoice.invoice,
            },
            updatedAt: Date.now(),
          };
          yield current;
        } else if (invoice.status === 'Cancelled') {
          current = {
            ...current,
            state: 'invoice_cancelled',
            result: {
              paymentHash,
              invoiceAddress: invoice.invoice_address,
              status: invoice.status,
              invoice: invoice.invoice,
            },
            completedAt: Date.now(),
            updatedAt: Date.now(),
          };
          yield current;
          current = transitionJobState(current, invoiceStateMachine, 'payment_failed_permanent');
          yield current;
          return;
        } else if (invoice.status === 'Expired') {
          current = {
            ...current,
            state: 'invoice_expired',
            result: {
              paymentHash,
              invoiceAddress: invoice.invoice_address,
              status: invoice.status,
              invoice: invoice.invoice,
            },
            completedAt: Date.now(),
            updatedAt: Date.now(),
          };
          yield current;
          current = transitionJobState(current, invoiceStateMachine, 'payment_failed_permanent');
          yield current;
          return;
        }

        await sleep(pollIntervalMs, signal);
      }
    }

    if (current.params.action === 'watch') {
      if (!current.params.getInvoicePaymentHash) {
        throw new Error('Invoice watch job requires getInvoicePaymentHash');
      }
      const paymentHash = current.params.getInvoicePaymentHash;
      while (true) {
        if (signal.aborted) {
          current = transitionJobState(current, invoiceStateMachine, 'cancel');
          yield current;
          return;
        }

        const invoice = await rpc.getInvoice({ payment_hash: paymentHash });
        current = {
          ...current,
          state:
            invoice.status === 'Paid'
              ? 'invoice_settled'
              : invoice.status === 'Received'
                ? 'invoice_received'
                : invoice.status === 'Cancelled'
                  ? 'invoice_cancelled'
                  : invoice.status === 'Expired'
                    ? 'invoice_expired'
                    : 'invoice_active',
          result: {
            paymentHash,
            invoiceAddress: invoice.invoice_address,
            status: invoice.status,
            invoice: invoice.invoice,
          },
          updatedAt: Date.now(),
        };
        yield current;

        if (invoice.status === 'Paid') {
          current = transitionJobState(current, invoiceStateMachine, 'payment_success');
          yield current;
          return;
        }
        if (invoice.status === 'Cancelled' || invoice.status === 'Expired') {
          current = transitionJobState(current, invoiceStateMachine, 'payment_failed_permanent');
          yield current;
          return;
        }

        await sleep(pollIntervalMs, signal);
      }
    }

    if (current.params.action === 'cancel') {
      if (!current.params.cancelInvoiceParams) {
        throw new Error('Invoice cancel job requires cancelInvoiceParams');
      }
      const cancelled = await rpc.cancelInvoice(current.params.cancelInvoiceParams);
      current = {
        ...current,
        state: 'invoice_cancelled',
        result: {
          paymentHash: current.params.cancelInvoiceParams.payment_hash,
          invoiceAddress: cancelled.invoice_address,
          status: cancelled.status,
          invoice: cancelled.invoice,
        },
        updatedAt: Date.now(),
      };
      yield current;
      current = transitionJobState(current, invoiceStateMachine, 'payment_success');
      yield current;
      return;
    }

    if (current.params.action === 'settle') {
      if (!current.params.settleInvoiceParams) {
        throw new Error('Invoice settle job requires settleInvoiceParams');
      }
      await rpc.settleInvoice(current.params.settleInvoiceParams);
      current = {
        ...current,
        state: 'invoice_settled',
        result: {
          paymentHash: current.params.settleInvoiceParams.payment_hash,
          status: 'Paid',
        },
        updatedAt: Date.now(),
      };
      yield current;
      current = transitionJobState(current, invoiceStateMachine, 'payment_success');
      yield current;
      return;
    }

    throw new Error(
      `Unsupported invoice action: ${(current.params as { action?: string }).action}`,
    );
  } catch (error) {
    const classified = classifyRpcError(error);
    current = applyRetryOrFail(current, classified, policy, {
      machine: invoiceStateMachine,
      retryEvent: 'payment_failed_retryable',
      failEvent: 'payment_failed_permanent',
    });
    yield current;
  }
}
