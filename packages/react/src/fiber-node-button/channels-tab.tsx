import type { UseFiberNodeResult } from '../use-fiber-node.js';
import { renderPanelAction } from './render-action.js';
import { styles } from './styles.js';
import {
  FILTER_ITEMS,
  type FiberNodeButtonActionDefaultProps,
  type FiberNodeButtonRenderAction,
  type FiberNodeButtonTabContext,
} from './types.js';
import type { FiberNodeButtonPanelState } from './use-panel-state.js';
import { formatChannelBalance, shorten, withDisabledStyle } from './utils.js';

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

        <div style={styles.filterBar}>
          {FILTER_ITEMS.map((filter) => (
            <button
              key={filter}
              type="button"
              style={channelFilter === filter ? styles.primaryButton : styles.actionButton}
              onClick={() => setChannelFilter(filter)}
            >
              {filter === 'all'
                ? `${t('channels.filter.all', 'All')} (${channelCounts.all})`
                : `${filter} (${channelCounts[filter]})`}
            </button>
          ))}
        </div>

        <div style={styles.list}>
          {visibleChannels.length === 0 ? (
            <p style={styles.compactText}>
              {t('channels.list.empty', 'No channels found for this filter.')}
            </p>
          ) : (
            visibleChannels.map((channel) => {
              const selected = channel.channel_id === selectedChannelId;

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
                    <span style={styles.badge}>{channel.state.state_name}</span>
                  </span>
                  <span style={styles.compactText}>
                    {t('channels.list.peer', 'Peer')}: {shorten(channel.pubkey, 16, 10)}
                  </span>
                  <span style={styles.compactText}>
                    L {formatChannelBalance(channel.local_balance)} / R{' '}
                    {formatChannelBalance(channel.remote_balance)} CKB
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
            <span style={styles.badge}>{selectedChannel.state.state_name}</span>
          </div>

          <p style={styles.inlineCode}>
            {t('channels.details.channelId', 'Channel ID')}: {selectedChannel.channel_id}
          </p>
          <p style={styles.inlineCode}>
            {t('channels.details.peer', 'Peer')}: {selectedChannel.pubkey}
          </p>

          <div style={styles.row}>
            <span style={styles.badge}>
              {t('channels.details.local', 'Local')}{' '}
              {formatChannelBalance(selectedChannel.local_balance)} CKB
            </span>
            <span style={styles.badge}>
              {t('channels.details.remote', 'Remote')}{' '}
              {formatChannelBalance(selectedChannel.remote_balance)} CKB
            </span>
            <span
              style={styles.badge}
              title="Pending TLCs are in-flight payment locks associated with this channel."
            >
              {t('channels.details.tlcs', 'TLCs')} {selectedChannel.pending_tlcs.length}
            </span>
          </div>

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
