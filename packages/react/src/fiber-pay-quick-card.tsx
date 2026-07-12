import type { GetPaymentResult, UdtAsset } from '@fiber-pay/sdk/browser';
import { DEFAULT_CKB_ASSET, formatAssetName } from '@fiber-pay/sdk/browser';
import { type CSSProperties, useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildNewInvoiceParams } from './invoice-params.js';
import { type UseFiberNodeResult, useFiberNode } from './use-fiber-node.js';
import { useFiberPayment } from './use-fiber-payment.js';

export interface FiberPayQuickCardProps {
  /** Reuse an existing useFiberNode() result instead of creating a new session. */
  fiber?: UseFiberNodeResult;
  network?: 'testnet' | 'mainnet';
  walletId?: string;
  passkeyUsername?: string;
  /** Asset for invoices and payments. Defaults to CKB. */
  asset?: UdtAsset;
  /** CKB display amount or raw integer UDT base units. Defaults to 1. */
  invoiceAmount?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  onInvoiceCreated?: (invoice: string) => void;
  onPaymentResult?: (result: GetPaymentResult) => void;
  onError?: (error: { scope: 'node' | 'payment' | 'invoice'; message: string }) => void;
}

const cardStyle: CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 8,
  padding: 16,
  maxWidth: 520,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
};

const rowWithMarginStyle: CSSProperties = {
  ...rowStyle,
  marginBottom: 8,
};

export function FiberPayQuickCard(props: FiberPayQuickCardProps) {
  const network = props.network ?? props.fiber?.network ?? 'testnet';
  const passkeyUsername = props.passkeyUsername ?? 'User';
  const title = props.title ?? 'FiberPay Quick Card';
  const asset = props.asset ?? DEFAULT_CKB_ASSET;
  const assetUnit = formatAssetName(asset);
  const assetAmountUnit = asset.kind === 'udt' ? `${assetUnit} base units` : assetUnit;
  let assetIdentity = 'ckb';
  if (asset.kind === 'udt') {
    const script = asset.script;
    assetIdentity = script
      ? `${script.code_hash}:${script.hash_type}:${script.args}`.toLowerCase()
      : 'udt:invalid';
  }
  const usesExternalFiber = !!props.fiber;
  const onError = props.onError;
  const onInvoiceCreated = props.onInvoiceCreated;
  const onPaymentResult = props.onPaymentResult;
  const passwordInputId = useId();
  const invoiceInputId = useId();
  const invoiceAmountInputId = useId();

  const managedFiber = useFiberNode({
    network,
    walletId: props.walletId,
    enabled: !usesExternalFiber,
  });

  const fiber = props.fiber ?? managedFiber;

  const {
    node,
    nodeInfo,
    state,
    error: nodeError,
    isPasskeySupported,
    hasPasskeyConfigured,
    startWithPassword,
    startWithPasskey,
    createPasskeyAndStart,
    stop,
  } = fiber;

  const paymentOptions = useMemo(() => ({ asset, network }), [asset, network]);
  const {
    payInvoice,
    isPaying,
    error: payError,
    paymentResult,
  } = useFiberPayment(node, paymentOptions);

  const [password, setPassword] = useState('');
  const [invoiceInput, setInvoiceInput] = useState('');
  const [invoiceAmountInput, setInvoiceAmountInput] = useState(props.invoiceAmount ?? '1');
  const [createdInvoice, setCreatedInvoice] = useState('');
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const previousAssetIdentityRef = useRef(assetIdentity);

  useEffect(() => {
    if (previousAssetIdentityRef.current === assetIdentity) {
      return;
    }
    previousAssetIdentityRef.current = assetIdentity;
    setInvoiceAmountInput(props.invoiceAmount ?? '1');
    setInvoiceInput('');
    setCreatedInvoice('');
    setInvoiceError(null);
  }, [assetIdentity, props.invoiceAmount]);

  useEffect(() => {
    if (nodeError) {
      onError?.({ scope: 'node', message: nodeError });
    }
  }, [nodeError, onError]);

  useEffect(() => {
    if (payError) {
      onError?.({ scope: 'payment', message: payError });
    }
  }, [onError, payError]);

  useEffect(() => {
    if (paymentResult) {
      onPaymentResult?.(paymentResult);
    }
  }, [onPaymentResult, paymentResult]);

  const createInvoice = async () => {
    if (!node) {
      return;
    }

    setIsCreatingInvoice(true);
    setInvoiceError(null);
    try {
      const amountInput = invoiceAmountInput.trim();
      const params = buildNewInvoiceParams({
        amountInput,
        asset,
        network,
        descriptionPrefix: 'FiberPay QuickCard invoice',
      });
      const created = await node.newInvoice(params);
      setCreatedInvoice(created.invoice_address);
      onInvoiceCreated?.(created.invoice_address);
    } catch (createInvoiceError) {
      const message =
        createInvoiceError instanceof Error
          ? createInvoiceError.message
          : String(createInvoiceError);
      setInvoiceError(message);
      onError?.({ scope: 'invoice', message });
    } finally {
      setIsCreatingInvoice(false);
    }
  };

  return (
    <div style={{ ...cardStyle, ...props.style }} className={props.className}>
      <h3>
        {title} ({network})
      </h3>

      {!nodeInfo ? (
        usesExternalFiber ? (
          <p>
            <strong>Connection required:</strong> connect the shared node first, then return here to
            create or pay invoices.
          </p>
        ) : (
          <>
            {isPasskeySupported ? (
              <div style={rowWithMarginStyle}>
                {hasPasskeyConfigured ? (
                  <button type="button" onClick={() => void startWithPasskey()}>
                    Login with Passkey
                  </button>
                ) : (
                  <button type="button" onClick={() => void createPasskeyAndStart(passkeyUsername)}>
                    Register Passkey
                  </button>
                )}
              </div>
            ) : null}

            <label htmlFor={passwordInputId}>Password</label>
            <div style={rowStyle}>
              <input
                id={passwordInputId}
                type="password"
                autoComplete="current-password"
                aria-label="Node password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
              />
              <button type="button" onClick={() => void startWithPassword(password)}>
                Start with Password
              </button>
            </div>
          </>
        )
      ) : (
        <>
          <p>
            <strong>State:</strong> {state}
          </p>
          <p>
            <strong>Pubkey:</strong> {nodeInfo.pubkey}
          </p>

          <div style={rowWithMarginStyle}>
            <button
              type="button"
              onClick={() => void createInvoice()}
              disabled={isCreatingInvoice || !invoiceAmountInput.trim()}
            >
              {isCreatingInvoice
                ? 'Creating...'
                : `Create Invoice (${invoiceAmountInput || '—'} ${assetUnit})`}
            </button>
            <button type="button" onClick={() => void stop()}>
              Stop Node
            </button>
          </div>

          <label htmlFor={invoiceAmountInputId}>Invoice Amount ({assetAmountUnit})</label>
          <div style={rowWithMarginStyle}>
            <input
              id={invoiceAmountInputId}
              aria-label="Invoice amount"
              value={invoiceAmountInput}
              onChange={(event) => setInvoiceAmountInput(event.target.value)}
              placeholder="1"
            />
          </div>

          {createdInvoice ? (
            <p>
              <strong>Created invoice:</strong> {createdInvoice}
            </p>
          ) : null}

          <label htmlFor={invoiceInputId}>Invoice</label>
          <div style={rowStyle}>
            <input
              id={invoiceInputId}
              aria-label="Invoice to pay"
              value={invoiceInput}
              onChange={(event) => setInvoiceInput(event.target.value)}
              placeholder="Paste invoice to pay"
            />
            <button type="button" onClick={() => void payInvoice(invoiceInput)} disabled={isPaying}>
              {isPaying ? 'Paying...' : 'Pay'}
            </button>
          </div>

          {paymentResult ? (
            <p>
              <strong>Payment:</strong> {paymentResult.status}
            </p>
          ) : null}
        </>
      )}

      {nodeError ? (
        <p style={{ color: '#b91c1c' }}>
          <strong>Node error:</strong> {nodeError}
        </p>
      ) : null}
      {payError ? (
        <p style={{ color: '#b91c1c' }}>
          <strong>Payment error:</strong> {payError}
        </p>
      ) : null}
      {invoiceError ? (
        <p style={{ color: '#b91c1c' }}>
          <strong>Invoice error:</strong> {invoiceError}
        </p>
      ) : null}
    </div>
  );
}
