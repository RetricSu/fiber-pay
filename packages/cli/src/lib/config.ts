import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type FiberNetwork, getConfigTemplate } from './config-templates.js';

export interface CliConfig {
  binaryPath?: string;
  dataDir: string;
  configPath: string;
  network: FiberNetwork;
  rpcUrl: string;
  rpcBiscuitToken?: string;
  keyPassword?: string;
  ckbRpcUrl?: string;
  runtimeProxyListen?: string;
}

/** Keys that can be stored in a profile.json file. */
export interface ProfileConfig {
  binaryPath?: string;
  keyPassword?: string;
  runtimeProxyListen?: string;
}

export interface EffectiveConfigSources {
  dataDir: 'cli' | 'env' | 'default';
  configPath: 'derived';
  network: 'cli' | 'env' | 'config' | 'default';
  rpcUrl: 'cli' | 'env' | 'config' | 'default';
  rpcBiscuitToken?: 'cli' | 'env' | 'unset';
  ckbRpcUrl?: 'env' | 'config' | 'unset';
  runtimeProxyListen?: 'cli' | 'env' | 'profile' | 'default';
}

export interface EffectiveConfig {
  config: CliConfig;
  sources: EffectiveConfigSources;
  configExists: boolean;
}

const DEFAULT_DATA_DIR = `${process.env.HOME}/.fiber-pay`;
const DEFAULT_RPC_URL = 'http://127.0.0.1:8227';
const DEFAULT_NETWORK: FiberNetwork = 'testnet';

export function getConfigPath(dataDir: string): string {
  return join(dataDir, 'config.yml');
}

export function parseNetworkFromConfig(configContent: string): FiberNetwork | undefined {
  const match = configContent.match(/^\s*chain:\s*(testnet|mainnet)\s*$/m);
  if (!match) return undefined;
  return match[1] as FiberNetwork;
}

export function parseRpcUrlFromConfig(configContent: string): string | undefined {
  const rpcSectionMatch = configContent.match(
    /(^|\n)rpc:\n([\s\S]*?)(\n[a-zA-Z_]+:|\nservices:|$)/,
  );
  const rpcSection = rpcSectionMatch?.[2];
  if (!rpcSection) return undefined;

  const match = rpcSection.match(/^\s*listening_addr:\s*"?([^"\n]+)"?\s*$/m);
  if (!match) return undefined;
  const listeningAddr = match[1].trim();
  if (!listeningAddr) return undefined;
  if (listeningAddr.startsWith('http://') || listeningAddr.startsWith('https://')) {
    return listeningAddr;
  }
  return `http://${listeningAddr}`;
}

export function parseCkbRpcUrlFromConfig(configContent: string): string | undefined {
  const ckbSectionMatch = configContent.match(
    /(^|\n)ckb:\n([\s\S]*?)(\n[a-zA-Z_]+:|\nservices:|$)/,
  );
  const ckbSection = ckbSectionMatch?.[2];
  if (!ckbSection) return undefined;

  const match = ckbSection.match(/^\s*rpc_url:\s*"?([^"\n]+)"?\s*$/m);
  return match?.[1]?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

function getProfilePath(dataDir: string): string {
  return join(dataDir, 'profile.json');
}

export function loadProfileConfig(dataDir: string): ProfileConfig | undefined {
  const profilePath = getProfilePath(dataDir);
  if (!existsSync(profilePath)) return undefined;
  try {
    const raw = readFileSync(profilePath, 'utf-8');
    return JSON.parse(raw) as ProfileConfig;
  } catch {
    return undefined;
  }
}

export function saveProfileConfig(dataDir: string, profile: ProfileConfig): void {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  const profilePath = getProfilePath(dataDir);
  writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf-8');
}

export function writeNetworkConfigFile(
  dataDir: string,
  network: FiberNetwork,
  options: { force?: boolean; rpcPort?: number; p2pPort?: number } = {},
): { path: string; created: boolean; overwritten: boolean } {
  const configPath = getConfigPath(dataDir);
  const alreadyExists = existsSync(configPath);

  if (alreadyExists && !options.force) {
    return { path: configPath, created: false, overwritten: false };
  }

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  let content = getConfigTemplate(network);

  if (options.rpcPort !== undefined || options.p2pPort !== undefined) {
    const lines = content.split('\n');
    let section: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const sectionMatch = lines[i].match(/^([a-zA-Z_]+):\s*$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        continue;
      }

      if (
        section === 'fiber' &&
        options.p2pPort !== undefined &&
        /^\s*listening_addr:\s*/.test(lines[i])
      ) {
        lines[i] = `  listening_addr: "/ip4/127.0.0.1/tcp/${options.p2pPort}"`;
      } else if (
        section === 'rpc' &&
        options.rpcPort !== undefined &&
        /^\s*listening_addr:\s*/.test(lines[i])
      ) {
        lines[i] = `  listening_addr: "127.0.0.1:${options.rpcPort}"`;
      }
    }

    content = lines.join('\n');
  }

  writeFileSync(configPath, content, 'utf-8');
  return { path: configPath, created: !alreadyExists, overwritten: alreadyExists };
}

export function ensureNodeConfigFile(dataDir: string, network: FiberNetwork): string {
  const configPath = getConfigPath(dataDir);
  if (!existsSync(configPath)) {
    writeNetworkConfigFile(dataDir, network);
  }
  return configPath;
}

export function getEffectiveConfig(explicitFlags?: Set<string>): EffectiveConfig {
  const dataDir = process.env.FIBER_DATA_DIR || DEFAULT_DATA_DIR;
  const dataDirSource: EffectiveConfigSources['dataDir'] = explicitFlags?.has('dataDir')
    ? 'cli'
    : process.env.FIBER_DATA_DIR
      ? 'env'
      : 'default';

  const configPath = getConfigPath(dataDir);
  const configExists = existsSync(configPath);
  const configContent = configExists ? readFileSync(configPath, 'utf-8') : undefined;

  // Load profile.json from the resolved data directory
  const profile = loadProfileConfig(dataDir);

  // --- Per-key priority ---
  // runtime keys: CLI flag > env var > config.yml > default
  // CLI-only keys: CLI flag > profile.json > env var

  // Network
  const cliNetwork = explicitFlags?.has('network')
    ? (process.env.FIBER_NETWORK as FiberNetwork | undefined)
    : undefined;
  const envNetwork = !explicitFlags?.has('network')
    ? (process.env.FIBER_NETWORK as FiberNetwork | undefined)
    : undefined;
  const fileNetwork = configContent ? parseNetworkFromConfig(configContent) : undefined;
  const network = cliNetwork || envNetwork || fileNetwork || DEFAULT_NETWORK;
  const networkSource: EffectiveConfigSources['network'] = cliNetwork
    ? 'cli'
    : envNetwork
      ? 'env'
      : fileNetwork
        ? 'config'
        : 'default';

  // RPC URL
  const cliRpcUrl = explicitFlags?.has('rpcUrl') ? process.env.FIBER_RPC_URL : undefined;
  const envRpcUrl = !explicitFlags?.has('rpcUrl') ? process.env.FIBER_RPC_URL : undefined;
  const fileRpcUrl = configContent ? parseRpcUrlFromConfig(configContent) : undefined;
  const rpcUrl = cliRpcUrl || envRpcUrl || fileRpcUrl || DEFAULT_RPC_URL;
  const rpcUrlSource: EffectiveConfigSources['rpcUrl'] = cliRpcUrl
    ? 'cli'
    : envRpcUrl
      ? 'env'
      : fileRpcUrl
        ? 'config'
        : 'default';

  // RPC Biscuit token (auth bearer token)
  const cliRpcBiscuitToken = explicitFlags?.has('rpcBiscuitToken')
    ? process.env.FIBER_RPC_BISCUIT_TOKEN
    : undefined;
  const envRpcBiscuitToken = !explicitFlags?.has('rpcBiscuitToken')
    ? process.env.FIBER_RPC_BISCUIT_TOKEN
    : undefined;
  const rpcBiscuitToken = cliRpcBiscuitToken || envRpcBiscuitToken || undefined;
  const rpcBiscuitTokenSource: EffectiveConfigSources['rpcBiscuitToken'] = cliRpcBiscuitToken
    ? 'cli'
    : envRpcBiscuitToken
      ? 'env'
      : 'unset';

  // Binary path
  const cliBinaryPath = explicitFlags?.has('binaryPath')
    ? process.env.FIBER_BINARY_PATH
    : undefined;
  const profileBinaryPath = profile?.binaryPath;
  const envBinaryPath = !explicitFlags?.has('binaryPath')
    ? process.env.FIBER_BINARY_PATH
    : undefined;
  const binaryPath = cliBinaryPath || profileBinaryPath || envBinaryPath || undefined;

  // Key password
  const cliKeyPassword = explicitFlags?.has('keyPassword')
    ? process.env.FIBER_KEY_PASSWORD
    : undefined;
  const profileKeyPassword = profile?.keyPassword;
  const envKeyPassword = !explicitFlags?.has('keyPassword')
    ? process.env.FIBER_KEY_PASSWORD
    : undefined;
  const keyPassword = cliKeyPassword || profileKeyPassword || envKeyPassword || undefined;

  // CKB RPC URL
  const envCkbRpcUrl = process.env.FIBER_CKB_RPC_URL;
  const fileCkbRpcUrl = configContent ? parseCkbRpcUrlFromConfig(configContent) : undefined;
  const ckbRpcUrl = envCkbRpcUrl || fileCkbRpcUrl || undefined;
  const ckbRpcUrlSource: EffectiveConfigSources['ckbRpcUrl'] = envCkbRpcUrl
    ? 'env'
    : fileCkbRpcUrl
      ? 'config'
      : 'unset';

  // Runtime proxy listen — CLI flag > env var > profile.json > default
  const DEFAULT_RUNTIME_PROXY_LISTEN = '127.0.0.1:8229';
  const cliRuntimeProxyListen = explicitFlags?.has('runtimeProxyListen')
    ? process.env.FIBER_RUNTIME_PROXY_LISTEN
    : undefined;
  const envRuntimeProxyListen = !explicitFlags?.has('runtimeProxyListen')
    ? process.env.FIBER_RUNTIME_PROXY_LISTEN
    : undefined;
  const profileRuntimeProxyListen = profile?.runtimeProxyListen;
  const runtimeProxyListen =
    cliRuntimeProxyListen ||
    envRuntimeProxyListen ||
    profileRuntimeProxyListen ||
    DEFAULT_RUNTIME_PROXY_LISTEN;
  const runtimeProxyListenSource: EffectiveConfigSources['runtimeProxyListen'] =
    cliRuntimeProxyListen
      ? 'cli'
      : envRuntimeProxyListen
        ? 'env'
        : profileRuntimeProxyListen
          ? 'profile'
          : 'default';

  return {
    configExists,
    config: {
      binaryPath,
      dataDir,
      configPath,
      network,
      rpcUrl,
      rpcBiscuitToken,
      keyPassword,
      ckbRpcUrl,
      runtimeProxyListen,
    },
    sources: {
      dataDir: dataDirSource,
      configPath: 'derived',
      network: networkSource,
      rpcUrl: rpcUrlSource,
      rpcBiscuitToken: rpcBiscuitTokenSource,
      ckbRpcUrl: ckbRpcUrlSource,
      runtimeProxyListen: runtimeProxyListenSource,
    },
  };
}

export function getConfig(): CliConfig {
  return getEffectiveConfig().config;
}
