import type { UdtAsset } from '@fiber-pay/sdk/browser';
import { formatAssetName } from '@fiber-pay/sdk/browser';
import { renderPanelAction } from './render-action.js';
import { styles } from './styles.js';
import type {
  FiberNodeButtonActionDefaultProps,
  FiberNodeButtonPanelProps,
  FiberNodeButtonRenderAction,
  FiberNodeButtonTabContext,
} from './types.js';
import type { FiberNodeButtonPanelState } from './use-panel-state.js';
import { shorten } from './utils.js';

export interface WorkbenchTabProps {
  state: FiberNodeButtonPanelState;
  fiber: FiberNodeButtonPanelProps['fiber'];
  asset: UdtAsset;
  externalFunding: FiberNodeButtonPanelProps['externalFunding'];
  renderConnectorSection: FiberNodeButtonPanelProps['renderConnectorSection'];
  renderAction?: FiberNodeButtonRenderAction;
  t: FiberNodeButtonTabContext['t'];
}

export function WorkbenchTab({
  state,
  fiber,
  asset,
  externalFunding,
  renderConnectorSection,
  renderAction,
  t,
}: WorkbenchTabProps) {
  const {
    isNodeReady,
    connectorContext,
    channelOpenFlow,
    peerListId,
    peerPubkey,
    setPeerPubkey,
    connectedPeers,
    fundingAmount,
    setFundingAmount,
    openChannel,
    isCreatingInvoice,
    createInvoice,
    createdInvoice,
    invoiceInput,
    setInvoiceInput,
    invoiceAmount,
    setInvoiceAmount,
    isPaying,
    submitPayment,
    paymentResult,
  } = state;

  return (
    <>
      <section style={styles.section}>
        <div style={styles.rowBetween}>
          <h4 style={styles.sectionTitle}>
            {t('workbench.connectionPrep.title', 'Connection Prep')}
          </h4>
          <span style={styles.badge}>
            {isNodeReady
              ? t('workbench.connectionPrep.connected', 'Connected')
              : t('workbench.connectionPrep.disconnected', 'Disconnected')}
          </span>
        </div>
        <p style={styles.compactText}>
          {t('workbench.connectionPrep.node', 'Node')}:{' '}
          {fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey, 18, 12) : t('meta.na', 'N/A')}
        </p>
        <p style={styles.compactText}>
          {t('workbench.connectionPrep.externalWallet', 'External wallet')}:{' '}
          {externalFunding?.enabled
            ? t('workbench.connectionPrep.enabled', 'Enabled')
            : t('workbench.connectionPrep.disabled', 'Disabled')}
        </p>

        {renderConnectorSection ? (
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.55rem' }}>
            {renderConnectorSection(connectorContext)}
          </div>
        ) : null}
      </section>

      <section style={styles.section}>
        <div style={styles.rowBetween}>
          <h4 style={styles.sectionTitle}>{t('workbench.openChannel.title', 'Open Channel')}</h4>
          {channelOpenFlow.lastResult ? (
            <span style={styles.badge}>
              {t('workbench.openChannel.recentSuccess', 'Recent Success')}
            </span>
          ) : null}
        </div>

        <label style={styles.fieldLabel}>
          {t('workbench.openChannel.targetPeerPubkey', 'Target Peer Pubkey')}
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
          {t('workbench.openChannel.fundingAmount', `Funding Amount (${formatAssetName(asset)})`)}
          <input
            style={styles.input}
            value={fundingAmount}
            onChange={(event) => setFundingAmount(event.target.value)}
            placeholder="1000"
          />
        </label>

        <div style={styles.row}>
          {renderPanelAction({
            id: 'open-channel',
            fiber,
            state,
            renderAction,
            t,
            buttonStyle: styles.primaryButton,
            defaultProps: {
              id: 'open-channel',
              label: t('actions.openChannel', 'Open Channel'),
              loadingLabel: t('actions.openChannel.loading', 'Opening...'),
              disabled: !isNodeReady || channelOpenFlow.isOpening || !peerPubkey.trim(),
              loading: channelOpenFlow.isOpening,
              onTrigger: openChannel,
            } satisfies FiberNodeButtonActionDefaultProps,
          })}
        </div>

        {channelOpenFlow.lastResult ? (
          <p style={styles.compactText}>
            {t('workbench.openChannel.lastChannel', 'Last channel')}:{' '}
            {shorten(channelOpenFlow.lastResult.channelId, 14, 8)}
          </p>
        ) : null}

        {channelOpenFlow.suggestedFundingAmountCkb ? (
          <p style={styles.compactText}>
            {t('workbench.openChannel.suggestedAmount', 'Suggested amount')}:{' '}
            {channelOpenFlow.suggestedFundingAmountCkb} CKB
          </p>
        ) : null}
      </section>

      <section style={styles.section}>
        <h4 style={styles.sectionTitle}>{t('workbench.payments.title', 'Payments')}</h4>

        <label style={styles.fieldLabel}>
          {t('workbench.payments.invoiceAmount', `Invoice Amount (${formatAssetName(asset)})`)}
          <input
            style={styles.input}
            value={invoiceAmount}
            onChange={(event) => setInvoiceAmount(event.target.value)}
            placeholder="1"
          />
        </label>

        <div style={styles.row}>
          {renderPanelAction({
            id: 'create-invoice',
            fiber,
            state,
            renderAction,
            t,
            defaultProps: {
              id: 'create-invoice',
              label: t(
                'actions.createInvoice',
                `Create Invoice (${invoiceAmount || '1'} ${formatAssetName(asset)})`,
              ),
              loadingLabel: t('actions.createInvoice.loading', 'Creating...'),
              disabled: isCreatingInvoice || !isNodeReady,
              loading: isCreatingInvoice,
              onTrigger: createInvoice,
            } satisfies FiberNodeButtonActionDefaultProps,
          })}
          {createdInvoice ? (
            <span style={styles.compactText}>{shorten(createdInvoice, 20, 10)}</span>
          ) : null}
        </div>

        <label style={styles.fieldLabel}>
          {t('workbench.payments.invoice', 'Invoice')}
          <input
            style={styles.input}
            value={invoiceInput}
            onChange={(event) => setInvoiceInput(event.target.value)}
            placeholder={t('workbench.payments.invoicePlaceholder', 'Paste invoice to pay')}
          />
        </label>

        <div style={styles.rowBetween}>
          {renderPanelAction({
            id: 'pay-invoice',
            fiber,
            state,
            renderAction,
            t,
            buttonStyle: styles.primaryButton,
            defaultProps: {
              id: 'pay-invoice',
              label: t('actions.payInvoice', 'Pay Invoice'),
              loadingLabel: t('actions.payInvoice.loading', 'Paying...'),
              disabled: isPaying || !isNodeReady || !invoiceInput.trim(),
              loading: isPaying,
              onTrigger: submitPayment,
            } satisfies FiberNodeButtonActionDefaultProps,
          })}

          <span style={styles.compactText}>
            {t('workbench.payments.status', 'Status')}:{' '}
            {paymentResult?.status ?? t('workbench.payments.idle', 'Idle')}
          </span>
        </div>
      </section>
    </>
  );
}
