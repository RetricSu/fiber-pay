import { styles } from './styles.js';
import type { FiberNodeButtonPanelProps } from './types.js';
import type { FiberNodeButtonPanelState } from './use-panel-state.js';
import { shorten, withDisabledStyle } from './utils.js';

export interface WorkbenchTabProps {
  state: FiberNodeButtonPanelState;
  fiber: FiberNodeButtonPanelProps['fiber'];
  externalFunding: FiberNodeButtonPanelProps['externalFunding'];
  renderConnectorSection: FiberNodeButtonPanelProps['renderConnectorSection'];
}

export function WorkbenchTab({
  state,
  fiber,
  externalFunding,
  renderConnectorSection,
}: WorkbenchTabProps) {
  const {
    isNodeReady,
    connectorContext,
    channelOpenFlow,
    peerListId,
    peerPubkey,
    setPeerPubkey,
    connectedPeers,
    fundingAmountCkb,
    setFundingAmountCkb,
    openChannel,
    isCreatingInvoice,
    createInvoice,
    createdInvoice,
    invoiceInput,
    setInvoiceInput,
    isPaying,
    submitPayment,
    paymentResult,
  } = state;

  return (
    <>
      <section style={styles.section}>
        <div style={styles.rowBetween}>
          <h4 style={styles.sectionTitle}>Connection Prep</h4>
          <span style={styles.badge}>{isNodeReady ? 'Connected' : 'Disconnected'}</span>
        </div>
        <p style={styles.compactText}>
          Node: {fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey, 18, 12) : 'N/A'}
        </p>
        <p style={styles.compactText}>
          External wallet: {externalFunding?.enabled ? 'Enabled' : 'Disabled'}
        </p>

        {renderConnectorSection ? (
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.55rem' }}>
            {renderConnectorSection(connectorContext)}
          </div>
        ) : null}
      </section>

      <section style={styles.section}>
        <div style={styles.rowBetween}>
          <h4 style={styles.sectionTitle}>Open Channel</h4>
          {channelOpenFlow.lastResult ? <span style={styles.badge}>Recent Success</span> : null}
        </div>

        <label style={styles.fieldLabel}>
          Target Peer Pubkey
          <input
            style={styles.input}
            list={peerListId}
            value={peerPubkey}
            onChange={(event) => setPeerPubkey(event.target.value)}
            placeholder={connectedPeers[0]?.pubkey ?? '0x...'}
          />
          <datalist id={peerListId}>
            {connectedPeers.map((peer) => (
              <option key={peer.pubkey} value={peer.pubkey} />
            ))}
          </datalist>
        </label>

        <label style={styles.fieldLabel}>
          Funding Amount (CKB)
          <input
            style={styles.input}
            value={fundingAmountCkb}
            onChange={(event) => setFundingAmountCkb(event.target.value)}
            placeholder="1000"
          />
        </label>

        <div style={styles.row}>
          <button
            type="button"
            style={withDisabledStyle(
              styles.primaryButton,
              !isNodeReady || channelOpenFlow.isOpening || !peerPubkey.trim(),
            )}
            disabled={!isNodeReady || channelOpenFlow.isOpening || !peerPubkey.trim()}
            onClick={() => {
              void openChannel();
            }}
          >
            {channelOpenFlow.isOpening ? 'Opening...' : 'Open Channel'}
          </button>
        </div>

        {channelOpenFlow.lastResult ? (
          <p style={styles.compactText}>
            Last channel: {shorten(channelOpenFlow.lastResult.channelId, 14, 8)}
          </p>
        ) : null}

        {channelOpenFlow.suggestedFundingAmountCkb ? (
          <p style={styles.compactText}>
            Suggested amount: {channelOpenFlow.suggestedFundingAmountCkb} CKB
          </p>
        ) : null}
      </section>

      <section style={styles.section}>
        <h4 style={styles.sectionTitle}>Payments</h4>

        <div style={styles.row}>
          <button
            type="button"
            style={withDisabledStyle(styles.actionButton, isCreatingInvoice || !isNodeReady)}
            disabled={isCreatingInvoice || !isNodeReady}
            onClick={() => {
              void createInvoice();
            }}
          >
            {isCreatingInvoice ? 'Creating...' : 'Create Invoice (1 CKB)'}
          </button>
          {createdInvoice ? (
            <span style={styles.compactText}>{shorten(createdInvoice, 20, 10)}</span>
          ) : null}
        </div>

        <label style={styles.fieldLabel}>
          Invoice
          <input
            style={styles.input}
            value={invoiceInput}
            onChange={(event) => setInvoiceInput(event.target.value)}
            placeholder="Paste invoice to pay"
          />
        </label>

        <div style={styles.rowBetween}>
          <button
            type="button"
            style={withDisabledStyle(
              styles.primaryButton,
              isPaying || !isNodeReady || !invoiceInput.trim(),
            )}
            disabled={isPaying || !isNodeReady || !invoiceInput.trim()}
            onClick={() => {
              void submitPayment();
            }}
          >
            {isPaying ? 'Paying...' : 'Pay Invoice'}
          </button>

          <span style={styles.compactText}>Status: {paymentResult?.status ?? 'Idle'}</span>
        </div>
      </section>
    </>
  );
}
