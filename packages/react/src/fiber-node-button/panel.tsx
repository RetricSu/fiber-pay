import { useEffect, useMemo, useRef } from 'react';
import { ChannelsTab } from './channels-tab.js';
import { DiagnosticsTab } from './diagnostics-tab.js';
import { defaultFiberNodeButtonI18n } from './i18n.js';
import { styles } from './styles.js';
import {
  type FiberNodeButtonPanelProps,
  type FiberNodeButtonTabConfig,
  type FiberNodeButtonTabContext,
  type FiberNodeButtonTabId,
  TAB_ITEMS,
} from './types.js';
import { useFiberNodeButtonPanelState } from './use-panel-state.js';
import { shorten, summarizeError } from './utils.js';
import { WorkbenchTab } from './workbench-tab.js';

interface ResolvedTabItem {
  id: FiberNodeButtonTabId;
  domId: string;
  label: string;
  render?: FiberNodeButtonTabConfig['render'];
}

function toDomSafeTabId(tabId: FiberNodeButtonTabId, index: number): string {
  const normalized = tabId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const safeBase = normalized.length > 0 ? normalized : 'tab';
  return `${safeBase}-${index + 1}`;
}

function resolveTabLabel(tabId: FiberNodeButtonTabId, t: FiberNodeButtonTabContext['t']): string {
  const builtIn = TAB_ITEMS.find((item) => item.id === tabId);
  if (!builtIn) {
    return tabId;
  }

  if (builtIn.id === 'workbench') {
    return t('tabs.workbench', builtIn.label);
  }
  if (builtIn.id === 'channels') {
    return t('tabs.channels', builtIn.label);
  }
  return t('tabs.diagnostics', builtIn.label);
}

function resolveTabs(
  tabs: ReadonlyArray<FiberNodeButtonTabConfig> | undefined,
  t: FiberNodeButtonTabContext['t'],
): ResolvedTabItem[] {
  const defaultIds = TAB_ITEMS.map((item) => item.id);

  if (!tabs || tabs.length === 0) {
    return defaultIds.map((id, index) => ({
      id,
      domId: toDomSafeTabId(id, index),
      label: resolveTabLabel(id, t),
    }));
  }

  const tabConfigById = new Map<FiberNodeButtonTabId, FiberNodeButtonTabConfig>();
  const orderedIds: FiberNodeButtonTabId[] = [];

  for (const tabConfig of tabs) {
    tabConfigById.set(tabConfig.id, tabConfig);
    if (!orderedIds.includes(tabConfig.id)) {
      orderedIds.push(tabConfig.id);
    }
  }

  for (const id of defaultIds) {
    if (!orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  }

  const resolvedTabs: ResolvedTabItem[] = [];

  for (const [index, id] of orderedIds.entries()) {
    const config = tabConfigById.get(id);
    if (config?.hidden) {
      continue;
    }

    const label =
      typeof config?.label === 'function'
        ? config.label(t)
        : (config?.label ?? resolveTabLabel(id, t));

    const tabItem: ResolvedTabItem = {
      id,
      domId: toDomSafeTabId(id, index),
      label,
    };

    if (config?.render) {
      tabItem.render = config.render;
    }

    resolvedTabs.push(tabItem);
  }

  return resolvedTabs;
}

export function FiberNodeButtonPanel(props: FiberNodeButtonPanelProps) {
  const {
    dropdownContext,
    fiber,
    onLog,
    externalFunding,
    renderConnectorSection,
    tabs,
    renderTabContent,
    renderAction,
  } = props;
  const t = props.t ?? defaultFiberNodeButtonI18n;
  const state = useFiberNodeButtonPanelState(props);
  const forceCloseDialogRef = useRef<HTMLDivElement | null>(null);

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
    openChannel,
    createInvoice,
    submitPayment,
  } = state;

  const tabActions = useMemo<FiberNodeButtonTabContext['actions']>(
    () => ({
      openChannel: async () => {
        await openChannel();
      },
      createInvoice: async () => {
        await createInvoice();
      },
      payInvoice: async () => {
        await submitPayment();
      },
      closeChannel: async (channelId: string) => {
        await closeChannel(channelId, false);
      },
      forceCloseChannel: async (channelId: string) => {
        await closeChannel(channelId, true);
      },
    }),
    [closeChannel, createInvoice, openChannel, submitPayment],
  );

  const tabContext = useMemo<FiberNodeButtonTabContext>(
    () => ({
      fiber,
      state,
      externalFundingEnabled: !!externalFunding?.enabled,
      t,
      actions: tabActions,
    }),
    [externalFunding?.enabled, fiber, state, t, tabActions],
  );

  const resolvedTabs = useMemo(() => resolveTabs(tabs, t), [t, tabs]);

  const effectiveActiveTab = useMemo(
    () =>
      resolvedTabs.some((tab) => tab.id === activeTab) ? activeTab : (resolvedTabs[0]?.id ?? null),
    [activeTab, resolvedTabs],
  );

  const selectedResolvedTab = useMemo(
    () => resolvedTabs.find((tab) => tab.id === effectiveActiveTab) ?? null,
    [effectiveActiveTab, resolvedTabs],
  );

  const tabListStyle = useMemo(
    () => ({
      ...styles.tabList,
      gridTemplateColumns: `repeat(${Math.max(1, resolvedTabs.length)}, minmax(112px, 1fr))`,
      overflowX: 'auto' as const,
    }),
    [resolvedTabs.length],
  );

  const overriddenTabContent = effectiveActiveTab
    ? renderTabContent?.(effectiveActiveTab, tabContext)
    : undefined;

  let tabContent = overriddenTabContent;
  if (tabContent === undefined) {
    if (selectedResolvedTab?.render) {
      tabContent = selectedResolvedTab.render(tabContext);
    } else if (effectiveActiveTab === 'workbench') {
      tabContent = (
        <WorkbenchTab
          state={state}
          fiber={fiber}
          externalFunding={externalFunding}
          renderConnectorSection={renderConnectorSection}
          renderAction={renderAction}
          t={t}
        />
      );
    } else if (effectiveActiveTab === 'channels') {
      tabContent = (
        <ChannelsTab state={state} onLog={onLog} renderAction={renderAction} t={t} fiber={fiber} />
      );
    } else if (effectiveActiveTab === 'diagnostics') {
      tabContent = <DiagnosticsTab state={state} t={t} />;
    } else if (effectiveActiveTab === null) {
      tabContent = (
        <div style={styles.notice}>{t('tabs.empty', 'No visible tabs are configured.')}</div>
      );
    } else {
      tabContent = (
        <div style={styles.notice}>
          {t('tabs.unimplemented', 'Tab content is not implemented.')}
        </div>
      );
    }
  }

  useEffect(() => {
    if (forceCloseConfirmOpen) {
      forceCloseDialogRef.current?.focus();
    }
  }, [forceCloseConfirmOpen]);

  useEffect(() => {
    if (resolvedTabs.length === 0) {
      return;
    }
    if (!resolvedTabs.some((tab) => tab.id === activeTab)) {
      switchTab(resolvedTabs[0].id);
    }
  }, [activeTab, resolvedTabs, switchTab]);

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
              <span style={styles.metricSub}>{t('metrics.node', 'Node')}</span>
            </span>

            <span style={styles.metricDivider} aria-hidden="true">
              |
            </span>

            <span style={styles.metricInline}>
              <span style={styles.metricMain}>
                {externalFunding?.enabled
                  ? t('metrics.funding.external', 'External')
                  : t('metrics.funding.internal', 'Internal')}
              </span>
              <span style={styles.metricSub}>{t('metrics.funding', 'Funding')}</span>
            </span>

            <span style={styles.metricDivider} aria-hidden="true">
              |
            </span>

            <span style={styles.metricInline}>
              <span style={styles.metricMain}>{activeChannelCount}</span>
              <span style={styles.metricSub}>{t('metrics.active', 'Active')}</span>
            </span>

            <span style={styles.metricDivider} aria-hidden="true">
              |
            </span>

            <span style={styles.metricInline}>
              <span style={styles.metricMain}>{connectedPeers.length}</span>
              <span style={styles.metricSub}>{t('metrics.peers', 'Peers')}</span>
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
                  <span style={styles.metricMain}>{t('metrics.error', 'Error')}</span>
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
              aria-label={t('actions.disconnect.aria', 'Disconnect node')}
            >
              {t('actions.disconnect', 'Disconnect')}
            </button>
            <button
              type="button"
              style={styles.globalActionButton}
              onClick={() => {
                dropdownContext.closeDropdown();
              }}
              aria-label={t('actions.closePanel.aria', 'Close panel')}
            >
              {t('actions.closePanel', 'Close Panel')}
            </button>
          </div>
        </div>

        <div style={styles.globalMeta}>
          <p style={styles.inlineCode}>
            {t('meta.node', 'Node')}:{' '}
            {fiber.nodeInfo?.pubkey ? shorten(fiber.nodeInfo.pubkey, 18, 12) : t('meta.na', 'N/A')}
          </p>
          {latestError ? (
            <p style={styles.globalErrorInline}>
              {t('meta.recentError', 'Recent error')}: {summarizeError(latestError, 92)}
            </p>
          ) : null}
        </div>
      </header>

      <div role="tablist" aria-label={t('tabs.aria', 'Fiber panel tabs')} style={tabListStyle}>
        {resolvedTabs.map((tab) => {
          const selected = effectiveActiveTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`${tabPanelId}-tab-${tab.domId}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? `${tabPanelId}-panel-${tab.domId}` : undefined}
              style={selected ? styles.tabButtonActive : styles.tabButton}
              onClick={() => switchTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id={`${tabPanelId}-panel-${selectedResolvedTab?.domId ?? 'empty'}`}
        role="tabpanel"
        aria-labelledby={
          selectedResolvedTab ? `${tabPanelId}-tab-${selectedResolvedTab.domId}` : undefined
        }
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

        {tabContent}

        {latestError ? <div style={styles.errorNotice}>{latestError}</div> : null}
      </div>

      {forceCloseConfirmOpen && selectedChannel ? (
        <div style={styles.dialogBackdrop}>
          <div
            ref={forceCloseDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('dialog.forceClose.aria', 'Force close confirmation')}
            tabIndex={-1}
            style={styles.dialogCard}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setForceCloseConfirmOpen(false);
              }
            }}
          >
            <h4 style={styles.sectionTitle}>
              {t('dialog.forceClose.title', 'Force close this channel?')}
            </h4>
            <p style={styles.compactText}>
              {t(
                'dialog.forceClose.description',
                'This action may immediately broadcast a unilateral close transaction, can lock liquidity until settlement, and may produce additional fees. Continue only if normal close cannot proceed.',
              )}
            </p>
            <p style={styles.inlineCode}>
              {t('dialog.forceClose.channel', 'Channel')}:{' '}
              {shorten(selectedChannel.channel_id, 20, 12)}
            </p>
            <div style={{ ...styles.row, justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={styles.actionButton}
                onClick={() => {
                  setForceCloseConfirmOpen(false);
                }}
              >
                {t('dialog.forceClose.cancel', 'Cancel')}
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
                {t('dialog.forceClose.confirm', 'Confirm Force Close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
