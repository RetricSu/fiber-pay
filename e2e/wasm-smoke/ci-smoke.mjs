import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4173;
const URL = `http://${HOST}:${PORT}`;
const TITLE_TIMEOUT_MS = 180_000;
const SERVER_TIMEOUT_MS = 60_000;

function getPnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || response.status === 304) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for dev server at ${url}`);
}

async function run() {
  const pnpm = getPnpmCommand();
  const server = spawn(pnpm, ['dev', '--host', HOST, '--port', String(PORT), '--strictPort'], {
    stdio: 'inherit',
  });

  let browser;
  try {
    await waitForServer(URL, SERVER_TIMEOUT_MS);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(
      () => document.title.startsWith('PASS:') || document.title.startsWith('FAIL:'),
      undefined,
      { timeout: TITLE_TIMEOUT_MS },
    );

    const title = await page.title();
    console.log(`WASM smoke title: ${title}`);

    if (title.startsWith('FAIL:')) {
      throw new Error(`WASM smoke failed: ${title}`);
    }

    if (!title.startsWith('PASS:')) {
      throw new Error(`WASM smoke produced unexpected title: ${title}`);
    }

    console.log('WASM smoke test passed');
  } finally {
    if (browser) {
      await browser.close();
    }
    server.kill('SIGTERM');
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
