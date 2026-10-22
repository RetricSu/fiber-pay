import type {
  FiberRpcClient,
  GetPaymentResult,
  NewInvoiceParams,
  NewInvoiceResult,
  ParseInvoiceResult,
} from '@fiber-pay/sdk';
import { useCallback, useState } from 'react';

export interface UseFiberPaymentResult {
  /** Create an invoice to receive a payment on this node. */
  createInvoice: (params: NewInvoiceParams) => Promise<NewInvoiceResult>;
  /** Decode an invoice string without paying it. */
  parseInvoice: (invoice: string) => Promise<ParseInvoiceResult>;
  /** Pay an invoice and wait for it to settle (or fail). */
  payInvoice: (invoice: string) => Promise<GetPaymentResult>;
  isPaying: boolean;
  paymentResult: GetPaymentResult | null;
  error: string | null;
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Receive and send Fiber payments against a connected `FiberRpcClient`
 * (from `useFiberNode`). CKB-only for now, no UDT asset handling.
 */
export function useFiberPayment(client: FiberRpcClient | null): UseFiberPaymentResult {
  const [isPaying, setIsPaying] = useState(false);
  const [paymentResult, setPaymentResult] = useState<GetPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ensureClient = useCallback(() => {
    if (!client) {
      throw new Error('Fiber client is not initialized');
    }
    return client;
  }, [client]);

  const createInvoice = useCallback(
    async (params: NewInvoiceParams) => ensureClient().newInvoice(params),
    [ensureClient],
  );

  const parseInvoice = useCallback(
    async (invoice: string) => ensureClient().parseInvoice({ invoice: invoice.trim() }),
    [ensureClient],
  );

  const payInvoice = useCallback(
    async (invoice: string) => {
      const activeClient = ensureClient();
      const normalizedInvoice = invoice.trim();
      setIsPaying(true);
      setError(null);
      setPaymentResult(null);

      try {
        const parsed = await activeClient.parseInvoice({ invoice: normalizedInvoice });
        await activeClient.sendPayment({ invoice: normalizedInvoice });
        const result = await activeClient.waitForPayment(parsed.invoice.data.payment_hash);

        if (result.status === 'Failed') {
          throw new Error(result.failed_error ?? 'Payment failed during routing/execution');
        }

        setPaymentResult(result);
        return result;
      } catch (payError) {
        setError(asErrorMessage(payError));
        throw payError;
      } finally {
        setIsPaying(false);
      }
    },
    [ensureClient],
  );

  return { createInvoice, parseInvoice, payInvoice, isPaying, paymentResult, error };
}
