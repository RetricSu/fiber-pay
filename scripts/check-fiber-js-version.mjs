#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf-8'));
}

function readText(path) {
  return readFileSync(resolve(ROOT, path), 'utf-8');
}

function fail(message) {
  console.error(`[check-fiber-js-version] ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`[check-fiber-js-version] ${message}`);
}

const sdkPeer = readJson('packages/sdk/package.json').peerDependencies?.['@nervosnetwork/fiber-js'];
if (!sdkPeer) {
  fail('packages/sdk/package.json is missing @nervosnetwork/fiber-js peerDependency');
}
ok(`SDK peerDependency: ${sdkPeer}`);

const workspaceYaml = readText('pnpm-workspace.yaml');
const catalogMatch = workspaceYaml.match(
  new RegExp(
    '^catalog:\\s*\\n(?:[ \\t]+.*\\n)*[ \\t]+["\']?@nervosnetwork/fiber-js["\']?:\\s*["\']?([^\\n"\']+)["\']?',
    'm',
  ),
);
if (!catalogMatch) {
  fail('pnpm-workspace.yaml is missing catalog entry for @nervosnetwork/fiber-js');
}
const catalogVersion = catalogMatch[1].trim();
if (catalogVersion !== sdkPeer) {
  fail(`pnpm-workspace.yaml catalog (${catalogVersion}) does not match SDK peerDependency (${sdkPeer})`);
}
ok(`Workspace catalog: ${catalogVersion}`);

const consumers = [
  ['e2e/wasm-smoke/package.json', 'dependencies'],
  ['packages/react/package.json', 'devDependencies'],
];

for (const [pkgPath, depField] of consumers) {
  const pkg = readJson(pkgPath);
  const declared = pkg[depField]?.['@nervosnetwork/fiber-js'];
  if (declared !== 'catalog:') {
    fail(`${pkgPath} must declare @nervosnetwork/fiber-js as "catalog:" in ${depField}, got ${declared}`);
  }
  ok(`${pkgPath} uses catalog:`);
}

ok('All @nervosnetwork/fiber-js versions are aligned.');
