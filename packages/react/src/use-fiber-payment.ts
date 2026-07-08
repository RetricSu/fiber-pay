import type {
  FiberBrowserNode,
  GetPaymentResult,
  ParseInvoiceResult,
  PaymentHash,
  SendPaymentResult,
  UdtAsset,
} from '@fiber-pay/sdk/browser';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseFiberPaymentResult {
  parseInvoice: (invoice: string) => Promise<ParseInvoiceResult>;
  sendPayment: (invoice: string, options?: { asset?: UdtAsset }) => Promise<SendPaymentResult>;
  waitForPayment: (paymentHash: PaymentHash) => Promise<GetPaymentResult>;
  payInvoice: (invoice: string, options?: { asset?: UdtAsset }) => Promise<void>;
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

export interface UseFiberPaymentOptions {
  asset?: UdtAsset;
}

export function useFiberPayment(
  node: FiberBrowserNode | null,
  options: UseFiberPaymentOptions = {},
): UseFiberPaymentResult {
  const [isPaying, setIsPaying] = useState(false);
  const [paymentResult, setPaymentResult] = useState<GetPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const ensureNode = useCallback(() => {
    if (!node) {
      throw new Error('Node is not initialized');
    }

    return node;
  }, [node]);

  const parseInvoiceInternal = useCallback(
    async (invoice: string) => {
      const activeNode = ensureNode();
      return activeNode.parseInvoice({ invoice });
    },
    [ensureNode],
  );

  const sendPaymentInternal = useCallback(
    async (invoice: string, paymentOptions?: { asset?: UdtAsset }) => {
      const activeNode = ensureNode();
      const asset = paymentOptions?.asset ?? options.asset;
      if (asset?.kind === 'udt') {
        return activeNode.sendPayment({ invoice, udt_type_script: asset.script });
      }
      return activeNode.sendPayment({ invoice });
    },
    [ensureNode, options.asset],
  );

  const waitForPaymentInternal = useCallback(
    async (paymentHash: PaymentHash) => {
      const activeNode = ensureNode();
      return activeNode.waitForPayment(paymentHash);
    },
    [ensureNode],
  );

  const parseInvoice = useCallback(
    async (invoice: string) => {
      if (isMountedRef.current) {
        setError(null);
      }

      try {
        return await parseInvoiceInternal(invoice);
      } catch (parseError) {
        if (isMountedRef.current) {
          setError(asErrorMessage(parseError));
        }
        throw parseError;
      }
    },
    [parseInvoiceInternal],
  );

  const sendPayment = useCallback(
    async (invoice: string, paymentOptions?: { asset?: UdtAsset }) => {
      if (isMountedRef.current) {
        setIsPaying(true);
        setError(null);
        setPaymentResult(null);
      }

      try {
        return await sendPaymentInternal(invoice, paymentOptions);
      } catch (sendError) {
        if (isMountedRef.current) {
          setError(asErrorMessage(sendError));
        }
        throw sendError;
      } finally {
        if (isMountedRef.current) {
          setIsPaying(false);
        }
      }
    },
    [sendPaymentInternal],
  );

  const waitForPayment = useCallback(
    async (paymentHash: PaymentHash) => {
      if (isMountedRef.current) {
        setIsPaying(true);
        setError(null);
        setPaymentResult(null);
      }

      try {
        const result = await waitForPaymentInternal(paymentHash);
        if (isMountedRef.current) {
          setPaymentResult(result);
        }
        return result;
      } catch (waitError) {
        if (isMountedRef.current) {
          setError(asErrorMessage(waitError));
        }
        throw waitError;
      } finally {
        if (isMountedRef.current) {
          setIsPaying(false);
        }
      }
    },
    [waitForPaymentInternal],
  );

  const payInvoice = useCallback(
    async (invoice: string, paymentOptions?: { asset?: UdtAsset }) => {
      if (isMountedRef.current) {
        setIsPaying(true);
        setError(null);
        setPaymentResult(null);
      }

      try {
        const parsed = await parseInvoiceInternal(invoice);
        await sendPaymentInternal(invoice, paymentOptions);

        const paymentHash = parsed.invoice.data.payment_hash;
        const result = await waitForPaymentInternal(paymentHash);

        if (result.status === 'Failed') {
          throw new Error(result.failed_error ?? 'Payment failed during routing/execution');
        }

        if (isMountedRef.current) {
          setPaymentResult(result);
        }
      } catch (payError) {
        if (isMountedRef.current) {
          setError(asErrorMessage(payError));
        }
      } finally {
        if (isMountedRef.current) {
          setIsPaying(false);
        }
      }
    },
    [parseInvoiceInternal, sendPaymentInternal, waitForPaymentInternal],
  );

  return {
    parseInvoice,
    sendPayment,
    waitForPayment,
    payInvoice,
    isPaying,
    paymentResult,
    error,
  };
}
