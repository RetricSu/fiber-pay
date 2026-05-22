import { ChannelsTab } from './channels-tab.js';
import { DiagnosticsTab } from './diagnostics-tab.js';
import { styles } from './styles.js';
import { type FiberNodeButtonPanelProps, TAB_ITEMS } from './types.js';
import { useFiberNodeButtonPanelState } from './use-panel-state.js';
import { shorten, summarizeError } from './utils.js';
import { WorkbenchTab } from './workbench-tab.js';

export function FiberNodeButtonPanel(props: FiberNodeButtonPanelProps) {
  const { dropdownContext, fiber, onLog, externalFunding, renderConnectorSection } = props;
  const state = useFiberNodeButtonPanelState(props);

  const {
    activeTab,
    switchTab,
    tabPanelId,
    statusNotice,
    latestError,
    activeChannelCount,
    connectedPeers,
    forceCloseConfirmOpen,
    setForceCloseConfirmOpen,
    selectedChannel,
    closeChannel,
  } = state;

  return (
    <div style={styles.shell}>
      <header style={styles.globalBar}>
        <div style={styles.globalRow}>
          <div style={styles.globalMetrics}>
            <span style={styles.metricInline}>
              <span
                style={{
                  ...styles.metricDot,
                  background:
                    fiber.state === 'running'
                      ? '#16a34a'
                      : fiber.state === 'error'
                        ? '#dc2626'
                        : '#64748b',
                }}
                aria-hidden="true"
              />
              <span style={styles.metricMain}>{fiber.state}</span>
              <span style={styles.metricSub}>Node</span>
            </span>

            <span style={styles.metricDivider} aria-hidden="true">
              |
            </span>

            <span style={styles.metricInline}>
              <span style={styles.metricMain}>
                {externalFunding?.enabled ? 'External' : 'Internal'}
              </span>
              <span style={styles.metricSub}>Funding</span>
            </span>

            <span style={styles.metricDivider} aria-hidden="true">
              |
            </span>

            <span style={styles.metricInline}>
              <span style={styles.metricMain}>{activeChannelCount}</span>
              <span style={styles.metricSub}>Active</span>
            </span>

            <span style={styles.metricDivider} aria-hidden="true">
              |
            </span>

            <span style={styles.metricInline}>
              <span style={styles.metricMain}>{connectedPeers.length}</span>
              <span style={styles.metricSub}>Peers</span>
            </span>

            {latestError ? (
              <>
                <span style={styles.metricDivider} aria-hidden="true">
                  |
                </span>
                <span style={styles.metricInline}>
                  <span
                    style={{
                      ...styles.metricDot,
                      background: '#dc2626',
                    }}
                    aria-hidden="true"
                  />
                  <span style={styles.metricMain}>Error</span>
                </span>
              </>
            ) : null}
          </div>

          <div style={styles.globalActions}>
            <button
              type="button"
              style={styles.globalActionButton}
              onClick={() => {
                void dropdownContext.disconnect();
              }}
              aria-label="Disconnect node"
            >
              Disconnect
            </button>
            <button
              type="button"
              style={styles.globalActionButton}
              onClick={() => {
                dropdownContext.closeDropdown();
              }}
              aria-label="Close panel"
            >
              Close Panel
            </button>
          </div>
        </div>

        <div style={styles.globalMeta}>
          <p style={styles.inlineCode}>
            Node: {fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey, 18, 12) : 'N/A'}
          </p>
          {latestError ? (
            <p style={styles.globalErrorInline}>Recent error: {summarizeError(latestError, 92)}</p>
          ) : null}
        </div>
      </header>

      <div role="tablist" aria-label="Fiber panel tabs" style={styles.tabList}>
        {TAB_ITEMS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`${tabPanelId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? `${tabPanelId}-panel-${tab.id}` : undefined}
              style={selected ? styles.tabButtonActive : styles.tabButton}
              onClick={() => switchTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id={`${tabPanelId}-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`${tabPanelId}-tab-${activeTab}`}
        style={styles.content}
      >
        {statusNotice ? (
          <div
            style={{
              ...styles.notice,
              ...(statusNotice.tone === 'success' ? styles.successNotice : {}),
            }}
          >
            {statusNotice.text}
          </div>
        ) : null}

        {activeTab === 'workbench' ? (
          <WorkbenchTab
            state={state}
            fiber={fiber}
            externalFunding={externalFunding}
            renderConnectorSection={renderConnectorSection}
          />
        ) : null}

        {activeTab === 'channels' ? <ChannelsTab state={state} onLog={onLog} /> : null}

        {activeTab === 'diagnostics' ? <DiagnosticsTab state={state} /> : null}

        {latestError ? <div style={styles.errorNotice}>{latestError}</div> : null}
      </div>

      {forceCloseConfirmOpen && selectedChannel ? (
        <div style={styles.dialogBackdrop}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Force close confirmation"
            style={styles.dialogCard}
          >
            <h4 style={styles.sectionTitle}>Force close this channel?</h4>
            <p style={styles.compactText}>
              This action may immediately broadcast a unilateral close transaction, can lock
              liquidity until settlement, and may produce additional fees. Continue only if normal
              close cannot proceed.
            </p>
            <p style={styles.inlineCode}>Channel: {shorten(selectedChannel.channel_id, 20, 12)}</p>
            <div style={{ ...styles.row, justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={styles.actionButton}
                onClick={() => {
                  setForceCloseConfirmOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.dangerButton}
                onClick={() => {
                  setForceCloseConfirmOpen(false);
                  onLog?.('fiber_channel_force_close_confirmed');
                  void closeChannel(selectedChannel.channel_id, true);
                }}
              >
                Confirm Force Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
