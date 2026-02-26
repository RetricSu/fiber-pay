import type { Alert } from './types.js';

const ANSI_RESET = '\x1b[0m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RED = '\x1b[31m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_BLUE = '\x1b[34m';
const ANSI_MAGENTA = '\x1b[35m';
const ANSI_CYAN = '\x1b[36m';

export interface FormatRuntimeAlertOptions {
  color?: 'auto' | 'always' | 'never';
  prefix?: string;
}

function clip(value: string, max = 120): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function summarizeAlertData(data: unknown, withColor: boolean): string {
  if (data === null || data === undefined) {
    return '{}';
  }

  if (typeof data !== 'object') {
    return clip(String(data), 160);
  }

  const record = data as Record<string, unknown>;
  const parts: string[] = [];

  const eventType = readStringField(record, 'type');
  if (eventType) {
    parts.push(`type=${eventType}`);
  }

  const channel = toRecord(record.channel);
  const previousChannel = toRecord(record.previousChannel);

  const channelId =
    readStringField(record, 'channelId') ??
    readStringField(channel ?? {}, 'channel_id') ??
    readStringField(previousChannel ?? {}, 'channel_id');
  if (channelId) {
    parts.push(`channelId=${channelId}`);
  }

  const paymentHash = readStringField(record, 'paymentHash');
  if (paymentHash) {
    parts.push(`paymentHash=${paymentHash}`);
  }

  const invoicePaymentHash = readStringField(record, 'invoicePaymentHash');
  if (invoicePaymentHash) {
    parts.push(`invoicePaymentHash=${invoicePaymentHash}`);
  }

  const peerId = readStringField(record, 'peerId') ?? readStringField(channel ?? {}, 'peer_id');
  if (peerId) {
    parts.push(`peerId=${peerId}`);
  }

  const jobId = readStringField(record, 'jobId');
  if (jobId) {
    parts.push(`jobId=${jobId}`);
  }

  const previousState = readStringField(record, 'previousState');
  const currentState = readStringField(record, 'currentState');
  if (previousState && currentState) {
    parts.push(
      colorize(`state=${previousState}->${currentState}`, `${ANSI_BOLD}${ANSI_YELLOW}`, withColor),
    );
  }

  const channelState = toRecord(channel?.state);
  const previousChannelState = toRecord(previousChannel?.state);
  const currentStateName = readStringField(channelState ?? {}, 'state_name');
  const previousStateName = readStringField(previousChannelState ?? {}, 'state_name');
  if (!previousState && !currentState && previousStateName && currentStateName) {
    parts.push(
      colorize(
        `state=${previousStateName}->${currentStateName}`,
        `${ANSI_BOLD}${ANSI_YELLOW}`,
        withColor,
      ),
    );
  } else if (!previousState && !currentState && currentStateName) {
    parts.push(colorize(`state=${currentStateName}`, `${ANSI_BOLD}${ANSI_YELLOW}`, withColor));
  }

  const reason = readStringField(record, 'reason') ?? readStringField(record, 'message');
  if (reason) {
    parts.push(`reason=${clip(reason, 80)}`);
  }

  const error = readStringField(record, 'error');
  if (error) {
    parts.push(`error=${clip(error, 80)}`);
  }

  if (parts.length > 0) {
    return parts.join(' ');
  }

  return clip(JSON.stringify(record), 160);
}

function shouldUseColor(mode: NonNullable<FormatRuntimeAlertOptions['color']>): boolean {
  if (mode === 'always') {
    return true;
  }
  if (mode === 'never') {
    return false;
  }
  return process.env.NO_COLOR === undefined && process.stdout.isTTY !== false;
}

function colorize(text: string, color: string, enabled: boolean): string {
  if (!enabled) {
    return text;
  }
  return `${color}${text}${ANSI_RESET}`;
}

export function formatRuntimeAlert(alert: Alert, options: FormatRuntimeAlertOptions = {}): string {
  const colorMode = options.color ?? 'auto';
  const withColor = shouldUseColor(colorMode);
  const priorityLabel = alert.priority.toUpperCase().padEnd(8, ' ');

  const priorityColor =
    alert.priority === 'critical'
      ? ANSI_RED
      : alert.priority === 'high'
        ? ANSI_YELLOW
        : alert.priority === 'medium'
          ? ANSI_CYAN
          : ANSI_GREEN;

  const typeColor = alert.type.startsWith('channel_')
    ? ANSI_BLUE
    : alert.type.startsWith('payment_') ||
        alert.type.startsWith('incoming_') ||
        alert.type.startsWith('outgoing_')
      ? ANSI_MAGENTA
      : ANSI_CYAN;

  const prefixLabel = options.prefix ?? '[fiber-runtime]';
  const prefix = colorize(prefixLabel, `${ANSI_BOLD}${ANSI_CYAN}`, withColor);
  const ts = colorize(alert.timestamp, ANSI_DIM, withColor);
  const priority = colorize(priorityLabel, `${ANSI_BOLD}${priorityColor}`, withColor);
  const type = colorize(alert.type, `${ANSI_BOLD}${typeColor}`, withColor);
  const data = colorize(summarizeAlertData(alert.data, withColor), ANSI_DIM, withColor);

  return `${prefix} ${ts} ${priority} ${type} ${data}`;
}
