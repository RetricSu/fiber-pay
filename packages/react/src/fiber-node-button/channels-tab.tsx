import { styles } from './styles.js';
import { FILTER_ITEMS } from './types.js';
import type { FiberNodeButtonPanelState } from './use-panel-state.js';
import { formatChannelBalance, shorten, withDisabledStyle } from './utils.js';

export interface ChannelsTabProps {
  state: FiberNodeButtonPanelState;
  onLog?: (message: string) => void;
}

export function ChannelsTab({ state, onLog }: ChannelsTabProps) {
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
          <h4 style={styles.sectionTitle}>Channel Summary</h4>
          <button
            type="button"
            style={withDisabledStyle(styles.actionButton, isRefreshingChannels)}
            disabled={isRefreshingChannels}
            onClick={() => {
              void refreshChannels();
            }}
          >
            {isRefreshingChannels ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <p style={styles.summaryInline}>
          Active {channelCounts.active} | Pending {channelCounts.pending} | Closed{' '}
          {channelCounts.closed} | Total {channelCounts.all}
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
                ? `All (${channelCounts.all})`
                : `${filter} (${channelCounts[filter]})`}
            </button>
          ))}
        </div>

        <div style={styles.list}>
          {visibleChannels.length === 0 ? (
            <p style={styles.compactText}>No channels found for this filter.</p>
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
                    {selected ? 'Selected channel' : 'Select channel'}
                  </span>
                  <span style={styles.compactChannelTop}>
                    <span style={styles.inlineCode}>ID: {shorten(channel.channel_id, 12, 8)}</span>
                    <span style={styles.badge}>{channel.state.state_name}</span>
                  </span>
                  <span style={styles.compactText}>Peer: {shorten(channel.pubkey, 16, 10)}</span>
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
            <h4 style={styles.sectionTitle}>Channel Details</h4>
            <span style={styles.badge}>{selectedChannel.state.state_name}</span>
          </div>

          <p style={styles.inlineCode}>Channel ID: {selectedChannel.channel_id}</p>
          <p style={styles.inlineCode}>Peer: {selectedChannel.pubkey}</p>

          <div style={styles.row}>
            <span style={styles.badge}>
              Local {formatChannelBalance(selectedChannel.local_balance)} CKB
            </span>
            <span style={styles.badge}>
              Remote {formatChannelBalance(selectedChannel.remote_balance)} CKB
            </span>
            <span
              style={styles.badge}
              title="Pending TLCs are in-flight payment locks associated with this channel."
            >
              TLCs {selectedChannel.pending_tlcs.length}
            </span>
          </div>

          {selectedChannel.failure_detail ? (
            <p style={styles.compactText}>Failure: {selectedChannel.failure_detail}</p>
          ) : null}

          {selectedChannel.shutdown_transaction_hash ? (
            <p style={styles.inlineCode}>
              Shutdown TX: {selectedChannel.shutdown_transaction_hash}
            </p>
          ) : null}

          <div style={{ ...styles.row, justifyContent: 'flex-end' }}>
            <button
              type="button"
              style={withDisabledStyle(styles.actionButton, !selectedCanClose || selectedIsClosing)}
              disabled={!selectedCanClose || selectedIsClosing}
              onClick={() => {
                if (!selectedChannel) {
                  return;
                }
                void closeChannel(selectedChannel.channel_id, false);
              }}
            >
              {selectedIsClosing
                ? 'Closing...'
                : selectedPending
                  ? 'Abandon Pending'
                  : 'Close Channel'}
            </button>

            <button
              type="button"
              style={withDisabledStyle(
                styles.dangerButton,
                !selectedCanClose || selectedPending || selectedIsClosing,
              )}
              disabled={!selectedCanClose || selectedPending || selectedIsClosing}
              onClick={() => {
                setForceCloseConfirmOpen(true);
                onLog?.('fiber_channel_force_close_confirm_opened');
              }}
            >
              Force Close
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
