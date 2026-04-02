import { useState, useCallback } from 'react';
import type { FiberBrowserNode, GetPaymentResult } from '@fiber-pay/sdk/browser';

export function useFiberPayment(node: FiberBrowserNode | null) {
  const [isPaying, setIsPaying] = useState(false);
  const [paymentResult, setPaymentResult] = useState<GetPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payInvoice = useCallback(
    async (invoiceString: string) => {
      if (!node) {
        setError('Node is not initialized');
        return;
      }

      setIsPaying(true);
      setError(null);
      setPaymentResult(null);

      try {
        // 1. Parse the invoice (though we could theoretically just send it)
        const parsed = await node.parseInvoice({ invoice: invoiceString });

        // 2. Identify if we need to connect to the peer (basic heuristic: no channels yet)
        // In a real advanced routing scenario, buildRouter might handle this.
        // For now, we attempt to just send payment because the node will route if it can.

        // 3. Send payment
        await node.sendPayment({ invoice: invoiceString });
        
        // 4. Wait for terminal status
        const payHash = parsed.invoice.data.payment_hash;
        const result = await node.waitForPayment(payHash);

        if (result.status === 'Failed') {
          throw new Error('Payment failed during routing/execution');
        }

        setPaymentResult(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsPaying(false);
      }
    },
    [node]
  );

  return {
    payInvoice,
    isPaying,
    paymentResult,
    error,
  };
}
