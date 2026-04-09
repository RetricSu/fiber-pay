/**
 * L402 Proxy Server
 *
 * Starts an Express reverse proxy that gates all incoming requests
 * behind L402 payment. Unauthenticated requests receive a 402 challenge
 * (macaroon + invoice); paid requests are forwarded to the target upstream.
 */

import { createServer, type Server } from 'node:http';
import type { Currency } from '@fiber-pay/sdk';
import { createL402Middleware, FiberRpcClient } from '@fiber-pay/sdk/node';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { CliConfig } from './config.js';
import { printJsonError, printJsonSuccess } from './format.js';

export interface L402ProxyOptions {
  target: string;
  port: string;
  host: string;
  price: string;
  rootKey?: string;
  expiry: string;
  json?: boolean;
}

export async function runL402ProxyCommand(
  config: CliConfig,
  options: L402ProxyOptions,
): Promise<void> {
  const asJson = Boolean(options.json);
  const port = parseInt(options.port, 10);
  const host = options.host;
  const priceCkb = parseFloat(options.price);
  const expirySeconds = parseInt(options.expiry, 10);
  const rootKey = options.rootKey || process.env.L402_ROOT_KEY;

  // Validate inputs
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    if (asJson) {
      printJsonError({
        code: 'L402_PROXY_INVALID_PORT',
        message: `Invalid port: ${options.port}`,
        recoverable: true,
        suggestion: 'Provide a valid port number between 1 and 65535.',
      });
    } else {
      console.error(`Error: Invalid port: ${options.port}`);
    }
    process.exit(1);
  }

  if (Number.isNaN(priceCkb) || priceCkb <= 0) {
    if (asJson) {
      printJsonError({
        code: 'L402_PROXY_INVALID_PRICE',
        message: `Invalid price: ${options.price}`,
        recoverable: true,
        suggestion: 'Provide a positive CKB amount, e.g. --price 0.1',
      });
    } else {
      console.error(`Error: Invalid price: ${options.price}`);
    }
    process.exit(1);
  }

  if (!rootKey) {
    if (asJson) {
      printJsonError({
        code: 'L402_PROXY_MISSING_ROOT_KEY',
        message: 'L402 root key is required.',
        recoverable: true,
        suggestion:
          'Provide --root-key <64-hex-chars> or set L402_ROOT_KEY environment variable. Generate one with: openssl rand -hex 32',
      });
    } else {
      console.error('Error: L402 root key is required.');
      console.error('  Provide --root-key <64-hex-chars> or set L402_ROOT_KEY env var.');
      console.error('  Generate one with: openssl rand -hex 32');
    }
    process.exit(1);
  }

  // Create RPC client using CLI config
  const rpcClient = new FiberRpcClient({
    url: config.rpcUrl,
    biscuitToken: config.rpcBiscuitToken,
  });

  const currency: Currency = config.network === 'mainnet' ? 'Fibb' : 'Fibt';

  // Build Express app
  const app = express();

  // L402 middleware on all routes
  app.use(
    createL402Middleware({
      rootKey,
      priceCkb,
      expirySeconds,
      rpcClient,
      currency,
    }),
  );

  // Proxy all authenticated requests to the target
  app.use(
    createProxyMiddleware({
      target: options.target,
      changeOrigin: true,
    }),
  );

  // Start the server
  const server: Server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        if (asJson) {
          printJsonError({
            code: 'L402_PROXY_PORT_IN_USE',
            message: `Port ${port} is already in use.`,
            recoverable: true,
            suggestion: `Use a different port with --port <port>.`,
          });
        } else {
          console.error(`Error: Port ${port} is already in use.`);
        }
        process.exit(1);
      }
      reject(err);
    });

    server.listen(port, host, () => {
      resolve();
    });
  });

  const listenUrl = `http://${host}:${port}`;

  if (asJson) {
    printJsonSuccess({
      status: 'running',
      listen: listenUrl,
      target: options.target,
      priceCkb,
      expirySeconds,
      currency,
      fiberRpcUrl: config.rpcUrl,
    });
  } else {
    console.log('L402 proxy started');
    console.log(`  Listen:     ${listenUrl}`);
    console.log(`  Target:     ${options.target}`);
    console.log(`  Price:      ${priceCkb} CKB per request`);
    console.log(`  Expiry:     ${expirySeconds}s`);
    console.log(`  Currency:   ${currency}`);
    console.log(`  Fiber RPC:  ${config.rpcUrl}`);
    console.log('');
    console.log('Press Ctrl+C to stop.');
  }

  // Graceful shutdown
  const shutdown = () => {
    if (!asJson) {
      console.log('\nStopping L402 proxy...');
    }
    server.close(() => {
      if (asJson) {
        printJsonSuccess({ status: 'stopped' });
      } else {
        console.log('L402 proxy stopped.');
      }
      process.exit(0);
    });

    // Force exit after 5s if connections don't close
    setTimeout(() => {
      process.exit(0);
    }, 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive
  await new Promise(() => {});
}
