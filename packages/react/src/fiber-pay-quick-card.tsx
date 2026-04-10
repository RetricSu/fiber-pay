import { type CSSProperties, useId, useState } from 'react';
import { useFiberNode } from './use-fiber-node.js';
import { useFiberPayment } from './use-fiber-payment.js';

export interface FiberPayQuickCardProps {
  network?: 'testnet' | 'mainnet';
  walletId?: string;
  passkeyUsername?: string;
}

const ONE_CKB_SHANNONS = '0x5f5e100';

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
  const network = props.network ?? 'testnet';
  const passkeyUsername = props.passkeyUsername ?? 'User';
  const passwordInputId = useId();
  const invoiceInputId = useId();

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
  } = useFiberNode({ network, walletId: props.walletId });

  const { payInvoice, isPaying, error: payError, paymentResult } = useFiberPayment(node);

  const [password, setPassword] = useState('');
  const [invoiceInput, setInvoiceInput] = useState('');
  const [createdInvoice, setCreatedInvoice] = useState('');
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);

  const createInvoice = async () => {
    if (!node) {
      return;
    }

    setIsCreatingInvoice(true);
    try {
      const created = await node.newInvoice({
        amount: ONE_CKB_SHANNONS,
        currency: network === 'mainnet' ? 'Fibb' : 'Fibt',
        description: 'FiberPay QuickCard invoice',
      });
      setCreatedInvoice(created.invoice_address);
    } finally {
      setIsCreatingInvoice(false);
    }
  };

  return (
    <div style={cardStyle}>
      <h3>FiberPay Quick Card ({network})</h3>

      {!nodeInfo ? (
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
      ) : (
        <>
          <p>
            <strong>State:</strong> {state}
          </p>
          <p>
            <strong>Pubkey:</strong> {nodeInfo.pubkey}
          </p>

          <div style={rowWithMarginStyle}>
            <button type="button" onClick={() => void createInvoice()} disabled={isCreatingInvoice}>
              {isCreatingInvoice ? 'Creating...' : 'Create Invoice (1 CKB)'}
            </button>
            <button type="button" onClick={() => void stop()}>
              Stop Node
            </button>
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
    </div>
  );
}
