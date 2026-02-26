import { sleep } from '../../utils/async.js';
import type { Alert, AlertBackend } from '../types.js';

export interface WebhookAlertBackendConfig {
  url: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export class WebhookAlertBackend implements AlertBackend {
  private readonly config: Required<WebhookAlertBackendConfig>;

  constructor(config: WebhookAlertBackendConfig) {
    this.config = {
      timeoutMs: 5000,
      headers: {},
      ...config,
    };
  }

  async send(alert: Alert): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetch(this.config.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...this.config.headers,
          },
          body: JSON.stringify(alert),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (response.ok) {
          return;
        }

        lastError = new Error(`Webhook response status: ${response.status}`);
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
      }

      await sleep(100 * 2 ** attempt);
    }

    throw new Error(`Failed to deliver webhook alert: ${String(lastError)}`);
  }
}
