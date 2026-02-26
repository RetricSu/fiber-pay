import { formatRuntimeAlert } from '../format.js';
import type { Alert, AlertBackend } from '../types.js';

export class StdoutAlertBackend implements AlertBackend {
  async send(alert: Alert): Promise<void> {
    console.log(formatRuntimeAlert(alert));
  }
}
