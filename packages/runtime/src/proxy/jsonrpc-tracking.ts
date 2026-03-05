import { isObject } from './json.js';

interface JsonRpcMessage {
  id?: string | number;
  method?: string;
  params?: unknown[];
  result?: unknown;
  error?: unknown;
}

export interface RequestMeta {
  method: string;
  dryRun: boolean;
}

export function collectJsonRpcMethods(requestBody: unknown): Map<string | number, RequestMeta> {
  const methods = new Map<string | number, RequestMeta>();
  for (const item of normalizeJsonRpcRequest(requestBody)) {
    if (item.id !== undefined && typeof item.method === 'string') {
      const dryRun = isDryRunRequest(item);
      methods.set(item.id, { method: item.method, dryRun });
    }
  }
  return methods;
}

export function captureTrackedHashes(
  methodById: Map<string | number, RequestMeta>,
  responseBody: unknown,
  handlers: {
    onInvoiceTracked: (paymentHash: string) => void;
    onPaymentTracked: (paymentHash: string) => void;
  },
): void {
  const responses = normalizeJsonRpcResponse(responseBody);

  for (const message of responses) {
    if (message.error || message.id === undefined) {
      continue;
    }
    const meta = methodById.get(message.id);
    if (!meta) {
      continue;
    }

    if (meta.method === 'new_invoice') {
      const paymentHash = extractInvoicePaymentHash(message.result);
      if (paymentHash) {
        handlers.onInvoiceTracked(paymentHash);
      }
    }

    // Skip tracking dry-run payments — the node never persists them,
    // so the tracker would poll getPayment forever.
    if (meta.method === 'send_payment' && !meta.dryRun) {
      const paymentHash = extractPaymentHash(message.result);
      if (paymentHash) {
        handlers.onPaymentTracked(paymentHash);
      }
    }
  }
}

function normalizeJsonRpcRequest(body: unknown): JsonRpcMessage[] {
  if (!body) {
    return [];
  }
  if (Array.isArray(body)) {
    return body.filter(isObject) as JsonRpcMessage[];
  }
  if (isObject(body)) {
    return [body as JsonRpcMessage];
  }
  return [];
}

function normalizeJsonRpcResponse(body: unknown): JsonRpcMessage[] {
  if (!body) {
    return [];
  }
  if (Array.isArray(body)) {
    return body.filter(isObject) as JsonRpcMessage[];
  }
  if (isObject(body)) {
    return [body as JsonRpcMessage];
  }
  return [];
}

function extractInvoicePaymentHash(result: unknown): string | undefined {
  if (!isObject(result)) {
    return undefined;
  }

  const invoice = result.invoice;
  if (!isObject(invoice)) {
    return undefined;
  }

  const data = invoice.data;
  if (!isObject(data)) {
    return undefined;
  }

  return typeof data.payment_hash === 'string' ? data.payment_hash : undefined;
}

function extractPaymentHash(result: unknown): string | undefined {
  if (!isObject(result)) {
    return undefined;
  }
  return typeof result.payment_hash === 'string' ? result.payment_hash : undefined;
}

function isDryRunRequest(message: JsonRpcMessage): boolean {
  if (!Array.isArray(message.params) || message.params.length === 0) {
    return false;
  }
  const firstParam = message.params[0];
  return isObject(firstParam) && firstParam.dry_run === true;
}
