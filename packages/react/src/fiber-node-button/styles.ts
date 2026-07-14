import type { CSSProperties } from 'react';

export const styles = {
  shell: {
    position: 'relative',
    display: 'grid',
    gridTemplateRows: 'auto auto minmax(0, 1fr)',
    gap: '0.7rem',
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    maxHeight: '72vh',
    boxSizing: 'border-box',
  } satisfies CSSProperties,

  globalBar: {
    border: '1px solid var(--fpay-border, #d8dee8)',
    borderRadius: '0.72rem',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
    padding: '0.52rem 0.56rem',
    display: 'grid',
    gap: '0.45rem',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
  } satisfies CSSProperties,

  globalRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '0.35rem',
    flexWrap: 'wrap',
    minWidth: 0,
  } satisfies CSSProperties,

  globalMetrics: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
    minWidth: 0,
    flex: '1 1 280px',
  } satisfies CSSProperties,

  metricInline: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.24rem',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,

  metricDot: {
    display: 'inline-flex',
    width: '0.34rem',
    height: '0.34rem',
    borderRadius: '999px',
    flexShrink: 0,
    background: '#94a3b8',
  } satisfies CSSProperties,

  metricMain: {
    fontSize: '0.82rem',
    fontWeight: 750,
    color: 'var(--fpay-text-primary, #0f172a)',
    lineHeight: 1.1,
  } satisfies CSSProperties,

  metricSub: {
    fontSize: '0.72rem',
    color: 'var(--fpay-text-secondary, #64748b)',
    lineHeight: 1.1,
  } satisfies CSSProperties,

  metricDivider: {
    fontSize: '0.7rem',
    color: '#94a3b8',
    lineHeight: 1,
  } satisfies CSSProperties,

  globalMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    flexWrap: 'wrap',
  } satisfies CSSProperties,

  globalErrorInline: {
    margin: 0,
    fontSize: '0.71rem',
    color: '#9f1239',
    lineHeight: 1.25,
  } satisfies CSSProperties,

  statusDot: {
    display: 'inline-flex',
    width: '0.45rem',
    height: '0.45rem',
    borderRadius: '999px',
    flexShrink: 0,
  } satisfies CSSProperties,

  globalActions: {
    display: 'flex',
    gap: '0.36rem',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    minWidth: 0,
    maxWidth: '100%',
    marginLeft: 'auto',
  } satisfies CSSProperties,

  globalActionButton: {
    border: '1px solid var(--fpay-border, #cbd5e1)',
    borderRadius: '0.45rem',
    padding: '0.28rem 0.48rem',
    fontSize: '0.72rem',
    fontWeight: 650,
    background: '#fff',
    color: 'var(--fpay-text-primary, #111827)',
    cursor: 'pointer',
    maxWidth: '100%',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  } satisfies CSSProperties,

  tabList: {
    borderRadius: '0.68rem',
    border: 'none',
    background: '#e9eef6',
    padding: '0.14rem',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '0.14rem',
    boxShadow: 'inset 0 0 0 1px var(--fpay-border, #d8dee8)',
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
  } satisfies CSSProperties,

  tabButton: {
    border: 'none',
    borderRadius: '0.5rem',
    background: 'transparent',
    color: '#334155',
    fontSize: '0.74rem',
    fontWeight: 700,
    padding: '0.44rem 0.45rem',
    cursor: 'pointer',
    minWidth: 0,
    width: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,

  tabButtonActive: {
    border: 'none',
    borderRadius: '0.5rem',
    background: 'var(--fpay-accent, #1d4ed8)',
    color: '#fff',
    fontSize: '0.74rem',
    fontWeight: 700,
    padding: '0.44rem 0.45rem',
    cursor: 'pointer',
    boxShadow: 'none',
    minWidth: 0,
    width: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,

  content: {
    overflowY: 'auto',
    paddingRight: '0.15rem',
    display: 'grid',
    gap: '0.7rem',
    minHeight: 0,
    minWidth: 0,
    maxWidth: '100%',
    overflowX: 'hidden',
  } satisfies CSSProperties,

  section: {
    border: 'none',
    borderBottom: '1px solid var(--fpay-border, #e2e8f0)',
    borderRadius: 0,
    padding: '0.15rem 0 0.55rem',
    background: 'transparent',
    display: 'grid',
    gap: '0.44rem',
    minWidth: 0,
    maxWidth: '100%',
  } satisfies CSSProperties,

  sectionTitle: {
    margin: 0,
    fontSize: '0.8rem',
    fontWeight: 750,
    color: 'var(--fpay-text-primary, #0f172a)',
    letterSpacing: '0.01em',
  } satisfies CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.45rem',
    flexWrap: 'wrap',
    minWidth: 0,
  } satisfies CSSProperties,

  rowBetween: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.45rem',
    flexWrap: 'wrap',
    minWidth: 0,
  } satisfies CSSProperties,

  compactText: {
    margin: 0,
    fontSize: '0.74rem',
    color: 'var(--fpay-text-secondary, #64748b)',
    lineHeight: 1.4,
    minWidth: 0,
    maxWidth: '100%',
    overflowWrap: 'anywhere',
  } satisfies CSSProperties,

  inlineCode: {
    margin: 0,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.72rem',
    color: 'var(--fpay-text-primary, #111827)',
    wordBreak: 'break-all',
    overflowWrap: 'anywhere',
    maxWidth: '100%',
    minWidth: 0,
    lineHeight: 1.4,
  } satisfies CSSProperties,

  fieldLabel: {
    display: 'grid',
    gap: '0.25rem',
    fontSize: '0.68rem',
    fontWeight: 700,
    color: 'var(--fpay-text-secondary, #64748b)',
    textTransform: 'uppercase',
    minWidth: 0,
    maxWidth: '100%',
  } satisfies CSSProperties,

  input: {
    width: '100%',
    border: '1px solid var(--fpay-border, #cbd5e1)',
    borderRadius: '0.45rem',
    padding: '0.38rem 0.48rem',
    fontSize: '0.8rem',
    background: '#fff',
    color: 'var(--fpay-text-primary, #0f172a)',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
  } satisfies CSSProperties,

  textarea: {
    width: '100%',
    border: '1px solid var(--fpay-border, #cbd5e1)',
    borderRadius: '0.45rem',
    padding: '0.38rem 0.48rem',
    fontSize: '0.75rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    lineHeight: 1.4,
    resize: 'vertical',
    background: '#fff',
    color: 'var(--fpay-text-primary, #0f172a)',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
  } satisfies CSSProperties,

  actionButton: {
    border: '1px solid var(--fpay-border, #cbd5e1)',
    borderRadius: '0.45rem',
    padding: '0.35rem 0.55rem',
    fontSize: '0.74rem',
    fontWeight: 650,
    background: '#fff',
    color: 'var(--fpay-text-primary, #111827)',
    cursor: 'pointer',
    maxWidth: '100%',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  } satisfies CSSProperties,

  primaryButton: {
    border: '1px solid var(--fpay-accent, #1d4ed8)',
    borderRadius: '0.45rem',
    padding: '0.35rem 0.55rem',
    fontSize: '0.74rem',
    fontWeight: 750,
    background: 'var(--fpay-accent, #1d4ed8)',
    color: '#fff',
    cursor: 'pointer',
    maxWidth: '100%',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  } satisfies CSSProperties,

  ghostButton: {
    border: '1px solid transparent',
    borderRadius: '0.45rem',
    padding: '0.32rem 0.5rem',
    fontSize: '0.74rem',
    fontWeight: 650,
    background: 'transparent',
    color: 'var(--fpay-text-secondary, #475569)',
    cursor: 'pointer',
    maxWidth: '100%',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  } satisfies CSSProperties,

  dangerButton: {
    border: '1px solid #fecaca',
    borderRadius: '0.45rem',
    padding: '0.35rem 0.55rem',
    fontSize: '0.74rem',
    fontWeight: 750,
    background: '#fff1f2',
    color: '#9f1239',
    cursor: 'pointer',
    maxWidth: '100%',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  } satisfies CSSProperties,

  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    width: 'fit-content',
    borderRadius: '999px',
    border: '1px solid var(--fpay-border, #cbd5e1)',
    background: '#f8fafc',
    color: 'var(--fpay-text-secondary, #475569)',
    padding: '0.12rem 0.4rem',
    fontSize: '0.66rem',
    fontWeight: 700,
    lineHeight: 1.1,
    maxWidth: '100%',
    minWidth: 0,
    whiteSpace: 'normal',
    wordBreak: 'break-all',
    overflowWrap: 'anywhere',
  } satisfies CSSProperties,

  notice: {
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: '0.52rem',
    padding: '0.46rem 0.52rem',
    fontSize: '0.74rem',
    lineHeight: 1.35,
  } satisfies CSSProperties,

  successNotice: {
    borderColor: '#86efac',
    background: '#f0fdf4',
    color: '#166534',
  } satisfies CSSProperties,

  errorNotice: {
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#9f1239',
    borderRadius: '0.52rem',
    padding: '0.46rem 0.52rem',
    fontSize: '0.74rem',
    lineHeight: 1.35,
  } satisfies CSSProperties,

  summaryGrid: {
    display: 'none',
  } satisfies CSSProperties,

  summaryTile: {
    display: 'none',
  } satisfies CSSProperties,

  summaryValue: {
    display: 'block',
    fontSize: '0.92rem',
    fontWeight: 750,
    color: 'var(--fpay-text-primary, #0f172a)',
    lineHeight: 1.1,
  } satisfies CSSProperties,

  summaryLabel: {
    display: 'block',
    marginTop: '0.12rem',
    fontSize: '0.64rem',
    color: 'var(--fpay-text-secondary, #64748b)',
  } satisfies CSSProperties,

  summaryInline: {
    margin: 0,
    fontSize: '0.76rem',
    color: 'var(--fpay-text-secondary, #475569)',
    lineHeight: 1.35,
  } satisfies CSSProperties,

  filterBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.28rem',
  } satisfies CSSProperties,

  filterStack: {
    display: 'grid',
    gap: '0.34rem',
    minWidth: 0,
  } satisfies CSSProperties,

  filterFieldset: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.28rem',
    minWidth: 0,
    margin: 0,
    padding: 0,
    border: 0,
  } satisfies CSSProperties,

  list: {
    display: 'grid',
    gap: '0.34rem',
    maxHeight: '240px',
    overflowY: 'auto',
    overflowX: 'hidden',
    paddingRight: '0.1rem',
    minWidth: 0,
    maxWidth: '100%',
  } satisfies CSSProperties,

  compactChannelRow: {
    border: '1px solid var(--fpay-border, #d8dee8)',
    borderRadius: '0.5rem',
    background: '#fff',
    padding: '0.42rem 0.46rem',
    cursor: 'pointer',
    display: 'grid',
    gap: '0.22rem',
    textAlign: 'left',
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
  } satisfies CSSProperties,

  compactChannelRowActive: {
    borderColor: 'var(--fpay-accent, #1d4ed8)',
    boxShadow: '0 0 0 1px rgba(29, 78, 216, 0.12) inset',
    background: '#f8fbff',
  } satisfies CSSProperties,

  compactChannelTop: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, auto)',
    alignItems: 'center',
    gap: '0.35rem',
    minWidth: 0,
  } satisfies CSSProperties,

  badgeGroup: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: '0.24rem',
    minWidth: 0,
    maxWidth: '100%',
  } satisfies CSSProperties,

  detailPanel: {
    border: '1px solid var(--fpay-border, #d8dee8)',
    borderRadius: '0.6rem',
    background: '#f8fafc',
    padding: '0.6rem',
    display: 'grid',
    gap: '0.45rem',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
  } satisfies CSSProperties,

  scriptCode: {
    margin: '0.42rem 0 0',
    maxWidth: '100%',
    maxHeight: '160px',
    overflow: 'auto',
    borderRadius: '0.45rem',
    background: '#eef2f7',
    padding: '0.45rem',
    boxSizing: 'border-box',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.68rem',
    lineHeight: 1.4,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  } satisfies CSSProperties,

  dialogBackdrop: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.36)',
    display: 'grid',
    placeItems: 'center',
    padding: '0.75rem',
    zIndex: 3,
  } satisfies CSSProperties,

  dialogCard: {
    width: 'min(100%, 360px)',
    borderRadius: '0.68rem',
    border: '1px solid #fecaca',
    background: '#fff',
    padding: '0.72rem',
    display: 'grid',
    gap: '0.55rem',
    maxWidth: '100%',
    boxSizing: 'border-box',
  } satisfies CSSProperties,

  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    border: 0,
  } satisfies CSSProperties,
};
