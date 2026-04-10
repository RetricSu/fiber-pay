import type { FiberBrowserNode, GetPaymentResult } from '@fiber-pay/sdk/browser';
import { useCallback, useState } from 'react';

export interface UseFiberPaymentResult {
  payInvoice: (invoice: string) => Promise<void>;
  isPaying: boolean;
  paymentResult: GetPaymentResult | null;
  error: string | null;
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function useFiberPayment(node: FiberBrowserNode | null): UseFiberPaymentResult {
  const [isPaying, setIsPaying] = useState(false);
  const [paymentResult, setPaymentResult] = useState<GetPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payInvoice = useCallback(
    async (invoice: string) => {
      if (!node) {
        setError('Node is not initialized');
        return;
      }

      setIsPaying(true);
      setError(null);
      setPaymentResult(null);

      try {
        const parsed = await node.parseInvoice({ invoice });
        await node.sendPayment({ invoice });

        const paymentHash = parsed.invoice.data.payment_hash;
        const result = await node.waitForPayment(paymentHash);

        if (result.status === 'Failed') {
          throw new Error('Payment failed during routing/execution');
        }

        setPaymentResult(result);
      } catch (payError) {
        setError(asErrorMessage(payError));
      } finally {
        setIsPaying(false);
      }
    },
    [node],
  );

  return {
    payInvoice,
    isPaying,
    paymentResult,
    error,
  };
}
