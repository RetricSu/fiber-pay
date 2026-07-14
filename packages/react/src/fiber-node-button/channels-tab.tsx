import type { FormattedChannelBalances } from '@fiber-pay/sdk/browser';
import { formatChannelBalances } from '@fiber-pay/sdk/browser';
import { useMemo } from 'react';
import type { UseFiberNodeResult } from '../use-fiber-node.js';
import { formatRawUdtAmount } from './assets.js';
import { renderPanelAction } from './render-action.js';
import { styles } from './styles.js';
import {
  FILTER_ITEMS,
  type FiberNodeButtonActionDefaultProps,
  type FiberNodeButtonRenderAction,
  type FiberNodeButtonTabContext,
} from './types.js';
import type { FiberNodeButtonPanelState } from './use-panel-state.js';
import { shorten, withDisabledStyle } from './utils.js';

function localizeAssetLabel(label: string, t: FiberNodeButtonTabContext['t']): string {
  if (label === 'CKB') return t('asset.ckb', 'CKB');
  if (label === 'UDT') return t('asset.udt', 'UDT');
  return label;
}

function formatChannelBalanceValue(
  balances: FormattedChannelBalances,
  side: 'local' | 'remote',
): string {
  const value =
    balances.kind === 'udt' ? formatRawUdtAmount(balances[side]) : balances[side].toFixed(4);
  return value;
}

function formatChannelBalanceUnit(assetLabel: string): string {
  return assetLabel;
}

function SelectedChannelBalance({
  balances,
  side,
  assetLabel,
}: {
  balances: FormattedChannelBalances | null;
  side: 'local' | 'remote';
  assetLabel: string;
}) {
  if (!balances) {
    return (
      <span style={styles.badge}>
        {side === 'local' ? 'Local' : 'Remote'} — {assetLabel}
      </span>
    );
  }

  return (
    <span style={styles.badge}>
      {side === 'local' ? 'Local' : 'Remote'} {formatChannelBalanceValue(balances, side)}{' '}
      {formatChannelBalanceUnit(assetLabel)}
    </span>
  );
}

export interface ChannelsTabProps {
  state: FiberNodeButtonPanelState;
  fiber: UseFiberNodeResult;
  onLog?: (message: string) => void;
  renderAction?: FiberNodeButtonRenderAction;
  t: FiberNodeButtonTabContext['t'];
}

export function ChannelsTab({ state, fiber, onLog, renderAction, t }: ChannelsTabProps) {
  const {
    isRefreshingChannels,
    refreshChannels,
    channelCounts,
    channelFilter,
    setChannelFilter,
    channelAssetFilter,
    setChannelAssetFilter,
    channelAssetCounts,
    channelFilterCounts,
    getChannelAssetLabel,
    visibleChannels,
    selectedChannelId,
    setSelectedChannelId,
    setForceCloseConfirmOpen,
    selectedChannel,
    selectedCanClose,
    selectedIsClosing,
    selectedPending,
    closeChannel,
  } = state;

  const channelBalances = useMemo(() => {
    const map = new Map<string, FormattedChannelBalances>();
    for (const channel of visibleChannels) {
      map.set(channel.channel_id, formatChannelBalances(channel));
    }
    return map;
  }, [visibleChannels]);

  const selectedChannelBalances = selectedChannel
    ? (channelBalances.get(selectedChannel.channel_id) ?? formatChannelBalances(selectedChannel))
    : null;
  const selectedChannelAssetLabel = selectedChannel
    ? localizeAssetLabel(getChannelAssetLabel(selectedChannel), t)
    : t('asset.ckb', 'CKB');

  return (
    <>
      <section style={styles.section}>
        <div style={styles.rowBetween}>
          <h4 style={styles.sectionTitle}>{t('channels.summary.title', 'Channel Summary')}</h4>
          <button
            type="button"
            style={withDisabledStyle(styles.actionButton, isRefreshingChannels)}
            disabled={isRefreshingChannels}
            onClick={() => {
              void refreshChannels();
            }}
          >
            {isRefreshingChannels
              ? t('channels.summary.refresh.loading', 'Refreshing...')
              : t('channels.summary.refresh', 'Refresh')}
          </button>
        </div>

        <p style={styles.summaryInline}>
          {t('channels.summary.active', 'Active')} {channelCounts.active} |{' '}
          {t('channels.summary.pending', 'Pending')} {channelCounts.pending} |{' '}
          {t('channels.summary.closed', 'Closed')} {channelCounts.closed} |{' '}
          {t('channels.summary.total', 'Total')} {channelCounts.all}
        </p>

        {channelAssetCounts.length > 1 ? (
          <p style={styles.summaryInline}>
            {t('channels.summary.assets', 'Assets: {assets}', {
              assets: channelAssetCounts
                .map((entry) => `${localizeAssetLabel(entry.label, t)} ${entry.count}`)
                .join(' · '),
            })}
          </p>
        ) : null}

        <div style={styles.filterStack}>
          <div style={styles.filterBar}>
            {FILTER_ITEMS.map((filter) => (
              <button
                key={filter}
                type="button"
                style={channelFilter === filter ? styles.primaryButton : styles.actionButton}
                onClick={() => setChannelFilter(filter)}
              >
                {filter === 'all'
                  ? `${t('channels.filter.all', 'All')} (${channelFilterCounts.all})`
                  : `${filter} (${channelFilterCounts[filter]})`}
              </button>
            ))}
          </div>

          {channelAssetCounts.length > 1 ? (
            <fieldset style={styles.filterFieldset}>
              <legend style={styles.srOnly}>
                {t('channels.filter.asset.aria', 'Channel asset filter')}
              </legend>
              <button
                type="button"
                style={channelAssetFilter === 'all' ? styles.primaryButton : styles.actionButton}
                onClick={() => setChannelAssetFilter('all')}
              >
                {t('channels.filter.asset.all', 'All')}
              </button>
              {channelAssetCounts.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  style={
                    channelAssetFilter === entry.key ? styles.primaryButton : styles.actionButton
                  }
                  onClick={() => setChannelAssetFilter(entry.key)}
                >
                  {localizeAssetLabel(entry.label, t)} ({entry.count})
                </button>
              ))}
            </fieldset>
          ) : null}
        </div>

        <div style={styles.list}>
          {visibleChannels.length === 0 ? (
            <p style={styles.compactText}>
              {t('channels.list.empty', 'No channels found for this filter.')}
            </p>
          ) : (
            visibleChannels.map((channel) => {
              const selected = channel.channel_id === selectedChannelId;
              const balances =
                channelBalances.get(channel.channel_id) ?? formatChannelBalances(channel);
              const assetLabel = localizeAssetLabel(getChannelAssetLabel(channel), t);

              return (
                <button
                  key={channel.channel_id}
                  type="button"
                  style={{
                    ...styles.compactChannelRow,
                    ...(selected ? styles.compactChannelRowActive : {}),
                  }}
                  onClick={() => {
                    setSelectedChannelId(channel.channel_id);
                    setForceCloseConfirmOpen(false);
                  }}
                >
                  <span style={styles.srOnly}>
                    {selected
                      ? t('channels.list.selected', 'Selected channel')
                      : t('channels.list.select', 'Select channel')}
                  </span>
                  <span style={styles.compactChannelTop}>
                    <span style={styles.inlineCode}>
                      {t('channels.list.id', 'ID')}: {shorten(channel.channel_id, 12, 8)}
                    </span>
                    <span style={styles.badgeGroup}>
                      <span style={styles.badge}>{assetLabel}</span>
                      <span style={styles.badge}>{channel.state.state_name}</span>
                    </span>
                  </span>
                  <span style={styles.compactText}>
                    {t('channels.list.peer', 'Peer')}: {shorten(channel.pubkey, 16, 10)}
                  </span>
                  <span style={styles.compactText}>
                    L {formatChannelBalanceValue(balances, 'local')} / R{' '}
                    {formatChannelBalanceValue(balances, 'remote')}{' '}
                    {formatChannelBalanceUnit(assetLabel)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      {selectedChannel ? (
        <section style={styles.detailPanel}>
          <div style={styles.rowBetween}>
            <h4 style={styles.sectionTitle}>{t('channels.details.title', 'Channel Details')}</h4>
            <span style={styles.badgeGroup}>
              <span style={styles.badge}>{selectedChannelAssetLabel}</span>
              <span style={styles.badge}>{selectedChannel.state.state_name}</span>
            </span>
          </div>

          <p style={styles.inlineCode}>
            {t('channels.details.channelId', 'Channel ID')}: {selectedChannel.channel_id}
          </p>
          <p style={styles.inlineCode}>
            {t('channels.details.peer', 'Peer')}: {selectedChannel.pubkey}
          </p>

          <div style={styles.row}>
            <SelectedChannelBalance
              balances={selectedChannelBalances}
              side="local"
              assetLabel={selectedChannelAssetLabel}
            />
            <SelectedChannelBalance
              balances={selectedChannelBalances}
              side="remote"
              assetLabel={selectedChannelAssetLabel}
            />
            <span
              style={styles.badge}
              title="Pending TLCs are in-flight payment locks associated with this channel."
            >
              {t('channels.details.tlcs', 'TLCs')} {selectedChannel.pending_tlcs.length}
            </span>
          </div>

          {selectedChannel.funding_udt_type_script ? (
            <details>
              <summary style={{ ...styles.compactText, cursor: 'pointer' }}>
                {t('channels.details.udtScript', 'Funding UDT Script')}
              </summary>
              <pre style={styles.scriptCode}>
                {JSON.stringify(selectedChannel.funding_udt_type_script, null, 2)}
              </pre>
            </details>
          ) : null}

          {selectedChannel.failure_detail ? (
            <p style={styles.compactText}>
              {t('channels.details.failure', 'Failure')}: {selectedChannel.failure_detail}
            </p>
          ) : null}

          {selectedChannel.shutdown_transaction_hash ? (
            <p style={styles.inlineCode}>
              {t('channels.details.shutdownTx', 'Shutdown TX')}:{' '}
              {selectedChannel.shutdown_transaction_hash}
            </p>
          ) : null}

          <div style={{ ...styles.row, justifyContent: 'flex-end' }}>
            {renderPanelAction({
              id: 'close-channel',
              fiber,
              state,
              renderAction,
              t,
              defaultProps: {
                id: 'close-channel',
                channelId: selectedChannel.channel_id,
                label: selectedPending
                  ? t('actions.abandonPending', 'Abandon Pending')
                  : t('actions.closeChannel', 'Close Channel'),
                loadingLabel: t('actions.closeChannel.loading', 'Closing...'),
                disabled: !selectedCanClose || selectedIsClosing,
                loading: selectedIsClosing,
                onTrigger: async () => {
                  await closeChannel(selectedChannel.channel_id, false);
                },
              } satisfies FiberNodeButtonActionDefaultProps,
            })}

            {renderPanelAction({
              id: 'force-close-channel',
              fiber,
              state,
              renderAction,
              t,
              buttonStyle: styles.dangerButton,
              defaultProps: {
                id: 'force-close-channel',
                channelId: selectedChannel.channel_id,
                label: t('actions.forceClose', 'Force Close'),
                disabled: !selectedCanClose || selectedPending || selectedIsClosing,
                onTrigger: () => {
                  setForceCloseConfirmOpen(true);
                  onLog?.('fiber_channel_force_close_confirm_opened');
                },
              } satisfies FiberNodeButtonActionDefaultProps,
            })}
          </div>
        </section>
      ) : null}
    </>
  );
}
