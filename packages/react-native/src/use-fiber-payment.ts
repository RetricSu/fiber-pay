import type {
  Attribute,
  CkbInvoice,
  FiberRpcClient,
  GetPaymentResult,
  NewInvoiceParams,
  NewInvoiceResult,
  ParseInvoiceResult,
} from '@fiber-pay/sdk';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface UseFiberPaymentOptions {
  /**
   * When set, `payInvoice` rejects an invoice whose currency doesn't match
   * (mainnet -> `Fibb`, testnet -> `Fibt`).
   */
  network?: 'testnet' | 'mainnet';
}

export interface UseFiberPaymentResult {
  /** Create an invoice to receive a payment on this node. */
  createInvoice: (params: NewInvoiceParams) => Promise<NewInvoiceResult>;
  /** Decode an invoice string without paying it. */
  parseInvoice: (invoice: string) => Promise<ParseInvoiceResult>;
  /**
   * Pay an invoice and wait for it to settle (or fail).
   *
   * Unlike `@fiber-pay/react`'s `payInvoice` (which returns `void` and
   * swallows errors into its `error` state), this resolves with the
   * settled `GetPaymentResult` and rethrows on failure, so a caller can
   * `await` it directly (e.g. to navigate on success). `error` is still
   * set either way, for callers that prefer to read state instead.
   */
  payInvoice: (invoice: string) => Promise<GetPaymentResult>;
  isPaying: boolean;
  paymentResult: GetPaymentResult | null;
  error: string | null;
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invoiceUdtScript(invoice: CkbInvoice): string | null {
  const udtAttr = invoice.data.attrs.find(
    (attr: Attribute): attr is Extract<Attribute, { udt_script: unknown }> => 'udt_script' in attr,
  );
  return udtAttr?.udt_script ?? null;
}

function assertPayable(invoice: CkbInvoice, network: 'testnet' | 'mainnet' | undefined): void {
  if (network) {
    const expectedCurrency = network === 'mainnet' ? 'Fibb' : 'Fibt';
    if (invoice.currency !== expectedCurrency) {
      throw new Error(
        `Invoice network mismatch: expected ${expectedCurrency}, received ${invoice.currency}`,
      );
    }
  }

  if (invoiceUdtScript(invoice)) {
    throw new Error('This invoice is for a UDT asset; useFiberPayment only supports CKB so far.');
  }
}

/**
 * Receive and send Fiber payments against a connected `FiberRpcClient`
 * (from `useFiberNode`). CKB-only: `payInvoice` rejects UDT invoices.
 */
export function useFiberPayment(
  client: FiberRpcClient | null,
  options: UseFiberPaymentOptions = {},
): UseFiberPaymentResult {
  const { network } = options;
  const [isPaying, setIsPaying] = useState(false);
  const [paymentResult, setPaymentResult] = useState<GetPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const clientGenerationRef = useRef(0);
  const inFlightClientsRef = useRef<WeakSet<FiberRpcClient>>(new WeakSet());

  // A response for a client that has since been swapped out (or a
  // component that has unmounted) must never land in this run's state.
  // Advance generation and reset payment state on client change in
  // useLayoutEffect to keep render phase pure and resilient to abandoned renders.
  // biome-ignore lint/correctness/useExhaustiveDependencies: client is a deliberate re-run trigger to bump generation and reset payment state, not read in the body.
  useLayoutEffect(() => {
    clientGenerationRef.current += 1;
    setIsPaying(false);
    setPaymentResult(null);
    setError(null);
  }, [client]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const canCommit = useCallback(
    (generation: number) => isMountedRef.current && generation === clientGenerationRef.current,
    [],
  );

  const ensureClient = useCallback(() => {
    if (!client) {
      throw new Error('Fiber client is not initialized');
    }
    return client;
  }, [client]);

  const createInvoice = useCallback(
    async (params: NewInvoiceParams) => {
      const generation = clientGenerationRef.current;
      try {
        return await ensureClient().newInvoice(params);
      } catch (createError) {
        if (canCommit(generation)) setError(asErrorMessage(createError));
        throw createError;
      }
    },
    [canCommit, ensureClient],
  );

  const parseInvoice = useCallback(
    async (invoice: string) => {
      const generation = clientGenerationRef.current;
      try {
        return await ensureClient().parseInvoice({ invoice: invoice.trim() });
      } catch (parseError) {
        if (canCommit(generation)) setError(asErrorMessage(parseError));
        throw parseError;
      }
    },
    [canCommit, ensureClient],
  );

  const payInvoice = useCallback(
    async (invoice: string) => {
      const activeClient = ensureClient();
      if (inFlightClientsRef.current.has(activeClient)) {
        throw new Error('A payment is already in progress on this client');
      }

      const generation = clientGenerationRef.current;
      const normalizedInvoice = invoice.trim();

      inFlightClientsRef.current.add(activeClient);
      if (canCommit(generation)) {
        setIsPaying(true);
        setError(null);
        setPaymentResult(null);
      }

      try {
        const parsed = await activeClient.parseInvoice({ invoice: normalizedInvoice });
        assertPayable(parsed.invoice, network);

        await activeClient.sendPayment({ invoice: normalizedInvoice });
        const result = await activeClient.waitForPayment(parsed.invoice.data.payment_hash);

        if (result.status === 'Failed') {
          throw new Error(result.failed_error ?? 'Payment failed during routing/execution');
        }

        if (canCommit(generation)) setPaymentResult(result);
        return result;
      } catch (payError) {
        if (canCommit(generation)) setError(asErrorMessage(payError));
        throw payError;
      } finally {
        inFlightClientsRef.current.delete(activeClient);
        if (canCommit(generation)) setIsPaying(false);
      }
    },
    [canCommit, ensureClient, network],
  );

  return { createInvoice, parseInvoice, payInvoice, isPaying, paymentResult, error };
}
