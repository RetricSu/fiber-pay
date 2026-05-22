import { styles } from './styles.js';
import type { FiberNodeButtonPanelState } from './use-panel-state.js';
import { formatChannelBalance, shorten, withDisabledStyle } from './utils.js';

export interface DiagnosticsTabProps {
  state: FiberNodeButtonPanelState;
}

export function DiagnosticsTab({ state }: DiagnosticsTabProps) {
  const {
    isRefreshingPeers,
    refreshConnectedPeers,
    connectedPeers,
    setPeerPubkey,
    switchTab,
    peerAddress,
    setPeerAddress,
    isConnectingPeer,
    connectPeerByAddress,
    isRefreshingGraph,
    refreshDiagnostics,
    refreshGraph,
    graphNodes,
    graphChannels,
    channelOpenFlow,
  } = state;

  return (
    <>
      <section style={styles.section}>
        <div style={styles.rowBetween}>
          <h4 style={styles.sectionTitle}>Connected Peers</h4>
          <button
            type="button"
            style={withDisabledStyle(styles.actionButton, isRefreshingPeers)}
            disabled={isRefreshingPeers}
            onClick={() => {
              void refreshConnectedPeers();
            }}
          >
            {isRefreshingPeers ? 'Refreshing...' : 'Refresh Peers'}
          </button>
        </div>

        <p style={styles.compactText}>Peers: {connectedPeers.length}</p>

        <div style={{ ...styles.list, maxHeight: '190px' }}>
          {connectedPeers.length === 0 ? (
            <p style={styles.compactText}>No connected peers.</p>
          ) : (
            connectedPeers.map((peer) => (
              <article key={peer.pubkey} style={styles.compactChannelRow}>
                <p style={styles.inlineCode}>{shorten(peer.pubkey, 18, 12)}</p>
                <details>
                  <summary style={{ ...styles.compactText, cursor: 'pointer' }}>Address</summary>
                  <p style={styles.inlineCode}>{peer.address}</p>
                </details>
                <div style={styles.row}>
                  <button
                    type="button"
                    style={styles.ghostButton}
                    onClick={() => {
                      setPeerPubkey(peer.pubkey);
                      switchTab('workbench');
                    }}
                  >
                    Use for Open Channel
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <label style={styles.fieldLabel}>
          Connect Peer Address
          <input
            style={styles.input}
            value={peerAddress}
            onChange={(event) => setPeerAddress(event.target.value)}
            placeholder="/dns4/.../wss/p2p/..."
          />
        </label>

        <div style={styles.rowBetween}>
          <button
            type="button"
            style={withDisabledStyle(styles.primaryButton, isConnectingPeer || !peerAddress.trim())}
            disabled={isConnectingPeer || !peerAddress.trim()}
            onClick={() => {
              void connectPeerByAddress();
            }}
          >
            {isConnectingPeer ? 'Connecting...' : 'Connect Peer'}
          </button>

          <button
            type="button"
            style={withDisabledStyle(styles.actionButton, isRefreshingPeers || isRefreshingGraph)}
            disabled={isRefreshingPeers || isRefreshingGraph}
            onClick={() => {
              void refreshDiagnostics();
            }}
          >
            {isRefreshingPeers || isRefreshingGraph ? 'Refreshing...' : 'Refresh All'}
          </button>
        </div>
      </section>

      <section style={styles.section}>
        <div style={styles.rowBetween}>
          <h4 style={styles.sectionTitle}>Graph Snapshot</h4>
          <button
            type="button"
            style={withDisabledStyle(styles.actionButton, isRefreshingGraph)}
            disabled={isRefreshingGraph}
            onClick={() => {
              void refreshGraph();
            }}
          >
            {isRefreshingGraph ? 'Refreshing...' : 'Refresh Graph'}
          </button>
        </div>

        <p style={styles.compactText}>
          showing {Math.min(graphNodes.length, 3)} of {graphNodes.length} nodes,{' '}
          {Math.min(graphChannels.length, 2)} of {graphChannels.length} channels.
        </p>

        {graphNodes.slice(0, 3).map((node) => (
          <p key={node.pubkey} style={styles.inlineCode}>
            Node: {node.node_name || shorten(node.pubkey, 18, 10)}
          </p>
        ))}

        {graphChannels.slice(0, 2).map((channel) => (
          <p
            key={`${channel.node1}-${channel.node2}-${channel.channel_outpoint.tx_hash}`}
            style={styles.inlineCode}
          >
            {shorten(channel.node1, 10, 6)} to {shorten(channel.node2, 10, 6)};{' '}
            {formatChannelBalance(channel.capacity)} CKB
          </p>
        ))}

        <details>
          <summary style={{ ...styles.compactText, cursor: 'pointer' }}>Raw graph snapshot</summary>
          <pre
            style={{
              ...styles.inlineCode,
              marginTop: '0.45rem',
              maxHeight: '160px',
              overflow: 'auto',
              background: '#f1f5f9',
              borderRadius: '0.45rem',
              padding: '0.45rem',
            }}
          >
            {JSON.stringify(
              {
                nodes: graphNodes,
                channels: graphChannels,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </section>

      {channelOpenFlow.diagnostic ? (
        <div style={styles.notice}>{channelOpenFlow.diagnostic}</div>
      ) : null}
    </>
  );
}
