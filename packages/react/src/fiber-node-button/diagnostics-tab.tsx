import type { HexString, Script } from '@fiber-pay/sdk/browser';
import { shannonsToCkb } from '@fiber-pay/sdk/browser';
import { useMemo } from 'react';
import { formatRawUdtAmount } from './assets.js';
import { styles } from './styles.js';
import type { FiberNodeButtonTabContext } from './types.js';
import type { FiberNodeButtonPanelState } from './use-panel-state.js';
import { shorten, withDisabledStyle } from './utils.js';

function formatGraphChannelCapacity(
  capacity: string,
  udtTypeScript: Script | null | undefined,
  assetLabel: string,
): string {
  if (udtTypeScript) {
    return `${formatRawUdtAmount(capacity)} ${assetLabel}`;
  }
  const ckb = shannonsToCkb(capacity as HexString);
  return Number.isFinite(ckb) ? `${ckb.toFixed(4)} ${assetLabel}` : `${capacity} shannons`;
}

export interface DiagnosticsTabProps {
  state: FiberNodeButtonPanelState;
  t: FiberNodeButtonTabContext['t'];
}

export function DiagnosticsTab({ state, t }: DiagnosticsTabProps) {
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
    getUdtAssetLabel,
  } = state;

  const formattedGraphChannels = useMemo(
    () =>
      graphChannels.slice(0, 2).map((channel) => {
        const rawAssetLabel = getUdtAssetLabel(channel.udt_type_script);
        const assetLabel =
          rawAssetLabel === 'CKB'
            ? t('asset.ckb', 'CKB')
            : rawAssetLabel === 'UDT'
              ? t('asset.udt', 'UDT')
              : rawAssetLabel;
        return {
          ...channel,
          displayCapacity: formatGraphChannelCapacity(
            channel.capacity,
            channel.udt_type_script,
            assetLabel,
          ),
        };
      }),
    [getUdtAssetLabel, graphChannels, t],
  );

  return (
    <>
      <section style={styles.section}>
        <div style={styles.rowBetween}>
          <h4 style={styles.sectionTitle}>{t('diagnostics.peers.title', 'Connected Peers')}</h4>
          <button
            type="button"
            style={withDisabledStyle(styles.actionButton, isRefreshingPeers)}
            disabled={isRefreshingPeers}
            onClick={() => {
              void refreshConnectedPeers();
            }}
          >
            {isRefreshingPeers
              ? t('diagnostics.peers.refresh.loading', 'Refreshing...')
              : t('diagnostics.peers.refresh', 'Refresh Peers')}
          </button>
        </div>

        <p style={styles.compactText}>
          {t('diagnostics.peers.count', 'Peers')}: {connectedPeers.length}
        </p>

        <div style={{ ...styles.list, maxHeight: '190px' }}>
          {connectedPeers.length === 0 ? (
            <p style={styles.compactText}>{t('diagnostics.peers.empty', 'No connected peers.')}</p>
          ) : (
            connectedPeers.map((peer) => (
              <article key={peer.pubkey} style={styles.compactChannelRow}>
                <p style={styles.inlineCode}>{shorten(peer.pubkey, 18, 12)}</p>
                <details>
                  <summary style={{ ...styles.compactText, cursor: 'pointer' }}>
                    {t('diagnostics.peers.address', 'Address')}
                  </summary>
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
                    {t('diagnostics.peers.useForOpenChannel', 'Use for Open Channel')}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <label style={styles.fieldLabel}>
          {t('diagnostics.peers.connectPeerAddress', 'Connect Peer Address')}
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
            {isConnectingPeer
              ? t('diagnostics.peers.connect.loading', 'Connecting...')
              : t('diagnostics.peers.connect', 'Connect Peer')}
          </button>

          <button
            type="button"
            style={withDisabledStyle(styles.actionButton, isRefreshingPeers || isRefreshingGraph)}
            disabled={isRefreshingPeers || isRefreshingGraph}
            onClick={() => {
              void refreshDiagnostics();
            }}
          >
            {isRefreshingPeers || isRefreshingGraph
              ? t('diagnostics.peers.refreshAll.loading', 'Refreshing...')
              : t('diagnostics.peers.refreshAll', 'Refresh All')}
          </button>
        </div>
      </section>

      <section style={styles.section}>
        <div style={styles.rowBetween}>
          <h4 style={styles.sectionTitle}>{t('diagnostics.graph.title', 'Graph Snapshot')}</h4>
          <button
            type="button"
            style={withDisabledStyle(styles.actionButton, isRefreshingGraph)}
            disabled={isRefreshingGraph}
            onClick={() => {
              void refreshGraph();
            }}
          >
            {isRefreshingGraph
              ? t('diagnostics.graph.refresh.loading', 'Refreshing...')
              : t('diagnostics.graph.refresh', 'Refresh Graph')}
          </button>
        </div>

        <p style={styles.compactText}>
          {t('diagnostics.graph.showing', 'showing')} {Math.min(graphNodes.length, 3)}{' '}
          {t('diagnostics.graph.of', 'of')} {graphNodes.length}{' '}
          {t('diagnostics.graph.nodes', 'nodes')}, {Math.min(graphChannels.length, 2)}{' '}
          {t('diagnostics.graph.of', 'of')} {graphChannels.length}{' '}
          {t('diagnostics.graph.channels', 'channels')}.
        </p>

        {graphNodes.slice(0, 3).map((node) => (
          <p key={node.pubkey} style={styles.inlineCode}>
            Node: {node.node_name || shorten(node.pubkey, 18, 10)}
          </p>
        ))}

        {formattedGraphChannels.map((channel) => (
          <p
            key={`${channel.node1}-${channel.node2}-${channel.channel_outpoint.tx_hash}`}
            style={styles.inlineCode}
          >
            {shorten(channel.node1, 10, 6)} to {shorten(channel.node2, 10, 6)};{' '}
            {channel.displayCapacity}
          </p>
        ))}

        <details>
          <summary style={{ ...styles.compactText, cursor: 'pointer' }}>
            {t('diagnostics.graph.rawSnapshot', 'Raw graph snapshot')}
          </summary>
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
