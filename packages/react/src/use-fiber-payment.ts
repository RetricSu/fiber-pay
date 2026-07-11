import {
  type FiberBrowserNode,
  type GetPaymentResult,
  type ParseInvoiceResult,
  type PaymentHash,
  type SendPaymentResult,
  serializeUdtTypeScript,
  type UdtAsset,
  validateUdtTypeScript,
} from '@fiber-pay/sdk/browser';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseFiberPaymentResult {
  parseInvoice: (invoice: string) => Promise<ParseInvoiceResult>;
  sendPayment: (invoice: string, options?: FiberPaymentOptions) => Promise<SendPaymentResult>;
  waitForPayment: (paymentHash: PaymentHash) => Promise<GetPaymentResult>;
  payInvoice: (invoice: string, options?: FiberPaymentOptions) => Promise<void>;
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
  network?: 'testnet' | 'mainnet';
}

export type FiberPaymentOptions = UseFiberPaymentOptions;

function getPaymentContextKey(options: UseFiberPaymentOptions): string {
  const asset = options.asset;
  const assetKey =
    !asset || asset.kind === 'ckb'
      ? 'ckb'
      : `${asset.script.code_hash}:${asset.script.hash_type}:${asset.script.args}`.toLowerCase();
  return `${options.network ?? 'unknown'}:${assetKey}`;
}

function getInvoiceUdtScript(parsed: ParseInvoiceResult): string | null {
  for (const attribute of parsed.invoice.data.attrs ?? []) {
    const record = attribute as unknown as Record<string, unknown>;
    const value = record.udt_script ?? record.UdtScript;
    if (typeof value === 'string') {
      return value.toLowerCase();
    }
  }
  return null;
}

function validateInvoiceContext(parsed: ParseInvoiceResult, options: FiberPaymentOptions): void {
  const asset = options.asset ?? { kind: 'ckb' as const };
  const invoiceUdtScript = getInvoiceUdtScript(parsed);

  if (options.network && parsed.invoice.currency) {
    const expectedCurrency = options.network === 'mainnet' ? 'Fibb' : 'Fibt';
    if (parsed.invoice.currency !== expectedCurrency) {
      throw new Error(
        `Invoice network mismatch: expected ${expectedCurrency}, received ${parsed.invoice.currency}`,
      );
    }
  }

  if (asset.kind === 'udt') {
    if (!invoiceUdtScript) {
      throw new Error('Invoice asset mismatch: expected a UDT invoice, received CKB');
    }
    const expectedScript = serializeUdtTypeScript(asset.script).toLowerCase();
    if (invoiceUdtScript !== expectedScript) {
      throw new Error(
        'Invoice asset mismatch: UDT type script does not match the configured asset',
      );
    }
    return;
  }

  if (invoiceUdtScript) {
    throw new Error('Invoice asset mismatch: expected CKB, received a UDT invoice');
  }
}

export function useFiberPayment(
  node: FiberBrowserNode | null,
  options: UseFiberPaymentOptions = {},
): UseFiberPaymentResult {
  const [isPaying, setIsPaying] = useState(false);
  const [paymentResult, setPaymentResult] = useState<GetPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const optionsRef = useRef(options);
  const previousContextKeyRef = useRef(getPaymentContextKey(options));
  const contextGenerationRef = useRef(0);
  const contextKey = getPaymentContextKey(options);

  useEffect(() => {
    optionsRef.current = options;
    if (previousContextKeyRef.current !== contextKey) {
      previousContextKeyRef.current = contextKey;
      contextGenerationRef.current += 1;
      setIsPaying(false);
      setPaymentResult(null);
      setError(null);
    }
  }, [contextKey, options]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const canCommitState = useCallback(
    (generation: number) => isMountedRef.current && generation === contextGenerationRef.current,
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
      const normalizedInvoice = invoice.trim();
      if (!normalizedInvoice) {
        throw new Error('Invoice is empty');
      }
      return activeNode.parseInvoice({ invoice: normalizedInvoice });
    },
    [ensureNode],
  );

  const sendPaymentInternal = useCallback(
    async (invoice: string, paymentOptions?: FiberPaymentOptions) => {
      const activeNode = ensureNode();
      const normalizedInvoice = invoice.trim();
      if (!normalizedInvoice) {
        throw new Error('Invoice is empty');
      }
      const asset = paymentOptions?.asset ?? optionsRef.current.asset;
      if (asset?.kind === 'udt') {
        const script = validateUdtTypeScript(asset.script);
        return activeNode.sendPayment({ invoice: normalizedInvoice, udt_type_script: script });
      }
      return activeNode.sendPayment({ invoice: normalizedInvoice });
    },
    [ensureNode],
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
      const generation = contextGenerationRef.current;
      if (canCommitState(generation)) {
        setError(null);
      }

      try {
        return await parseInvoiceInternal(invoice);
      } catch (parseError) {
        if (canCommitState(generation)) {
          setError(asErrorMessage(parseError));
        }
        throw parseError;
      }
    },
    [canCommitState, parseInvoiceInternal],
  );

  const sendPayment = useCallback(
    async (invoice: string, paymentOptions?: FiberPaymentOptions) => {
      const generation = contextGenerationRef.current;
      if (canCommitState(generation)) {
        setIsPaying(true);
        setError(null);
        setPaymentResult(null);
      }

      try {
        return await sendPaymentInternal(invoice, paymentOptions);
      } catch (sendError) {
        if (canCommitState(generation)) {
          setError(asErrorMessage(sendError));
        }
        throw sendError;
      } finally {
        if (canCommitState(generation)) {
          setIsPaying(false);
        }
      }
    },
    [canCommitState, sendPaymentInternal],
  );

  const waitForPayment = useCallback(
    async (paymentHash: PaymentHash) => {
      const generation = contextGenerationRef.current;
      if (canCommitState(generation)) {
        setIsPaying(true);
        setError(null);
        setPaymentResult(null);
      }

      try {
        const result = await waitForPaymentInternal(paymentHash);
        if (canCommitState(generation)) {
          setPaymentResult(result);
        }
        return result;
      } catch (waitError) {
        if (canCommitState(generation)) {
          setError(asErrorMessage(waitError));
        }
        throw waitError;
      } finally {
        if (canCommitState(generation)) {
          setIsPaying(false);
        }
      }
    },
    [canCommitState, waitForPaymentInternal],
  );

  const payInvoice = useCallback(
    async (invoice: string, paymentOptions?: FiberPaymentOptions) => {
      const generation = contextGenerationRef.current;
      if (canCommitState(generation)) {
        setIsPaying(true);
        setError(null);
        setPaymentResult(null);
      }

      try {
        const parsed = await parseInvoiceInternal(invoice);
        const effectiveOptions = { ...optionsRef.current, ...paymentOptions };
        validateInvoiceContext(parsed, effectiveOptions);
        await sendPaymentInternal(invoice, paymentOptions);

        const paymentHash = parsed.invoice.data.payment_hash;
        const result = await waitForPaymentInternal(paymentHash);

        if (result.status === 'Failed') {
          throw new Error(result.failed_error ?? 'Payment failed during routing/execution');
        }

        if (canCommitState(generation)) {
          setPaymentResult(result);
        }
      } catch (payError) {
        if (canCommitState(generation)) {
          setError(asErrorMessage(payError));
        }
      } finally {
        if (canCommitState(generation)) {
          setIsPaying(false);
        }
      }
    },
    [canCommitState, parseInvoiceInternal, sendPaymentInternal, waitForPaymentInternal],
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
