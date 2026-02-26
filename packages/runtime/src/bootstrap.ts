import type { RuntimeConfigInput } from './config.js';
import { FiberMonitorService } from './service.js';

export interface RuntimeBootstrap {
  service: FiberMonitorService;
  stop: () => Promise<void>;
  waitForShutdownSignal: () => Promise<NodeJS.Signals>;
}

export async function startRuntimeService(
  configInput: RuntimeConfigInput = {},
): Promise<RuntimeBootstrap> {
  const service = new FiberMonitorService(configInput);
  await service.start();

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    await service.stop();
  };

  const waitForShutdownSignal = (): Promise<NodeJS.Signals> => {
    return new Promise((resolve) => {
      const onSignal = (signal: NodeJS.Signals) => {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        resolve(signal);
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
    });
  };

  return {
    service,
    stop,
    waitForShutdownSignal,
  };
}
