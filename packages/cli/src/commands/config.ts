import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { parseDocument, stringify as yamlStringify } from 'yaml';
import {
  type CliConfig,
  getEffectiveConfig,
  loadProfileConfig,
  type ProfileConfig,
  parseNetworkFromConfig,
  saveProfileConfig,
  writeNetworkConfigFile,
} from '../lib/config.js';
import type { FiberNetwork } from '../lib/config-templates.js';
import { printJsonError, printJsonSuccess } from '../lib/format.js';

function parseNetworkInput(input: string | undefined): FiberNetwork {
  if (!input) return 'testnet';
  if (input === 'testnet' || input === 'mainnet') return input;
  throw new Error(`Invalid network: ${input}. Expected one of: testnet, mainnet`);
}

function parsePortInput(
  input: string | undefined,
  label: 'rpc-port' | 'p2p-port' | 'proxy-port',
): number | undefined {
  if (input === undefined) return undefined;
  const parsed = Number.parseInt(input, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid ${label}: ${input}. Expected integer in range 1-65535.`);
  }
  return parsed;
}

function resolvePort(
  optionValue: string | undefined,
  envValue: string | undefined,
  label: 'rpc-port' | 'p2p-port',
): { value: number | undefined; source: 'option' | 'env' | 'unset' } {
  if (optionValue !== undefined) {
    return { value: parsePortInput(optionValue, label), source: 'option' };
  }
  if (envValue !== undefined) {
    return { value: parsePortInput(envValue, label), source: 'env' };
  }
  return { value: undefined, source: 'unset' };
}

type ConfigValueType = 'auto' | 'string' | 'number' | 'boolean' | 'null' | 'json';
type ConfigPathSegment = string | number;

const LEGACY_PATH_ALIASES: Record<string, string> = {
  chain: 'fiber.chain',
};

function resolveConfigPathAlias(path: string): string {
  return LEGACY_PATH_ALIASES[path] ?? path;
}

function parseConfigPath(path: string): ConfigPathSegment[] {
  const normalized = resolveConfigPathAlias(path).trim();
  if (!normalized) {
    throw new Error('Config path cannot be empty.');
  }

  const segments: ConfigPathSegment[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  for (const match of normalized.matchAll(re)) {
    if (match[1]) {
      segments.push(match[1]);
    } else if (match[2]) {
      segments.push(Number.parseInt(match[2], 10));
    }
  }

  if (segments.length === 0) {
    throw new Error(`Invalid config path: ${path}`);
  }

  return segments;
}

function parseTypedValue(raw: string, valueType: ConfigValueType): unknown {
  if (valueType === 'string') return raw;
  if (valueType === 'null') return null;

  if (valueType === 'number') {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid number value: ${raw}`);
    }
    return parsed;
  }

  if (valueType === 'boolean') {
    const lowered = raw.toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
    throw new Error(`Invalid boolean value: ${raw}. Expected true or false.`);
  }

  if (valueType === 'json') {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON value: ${raw}`);
    }
  }

  const lowered = raw.toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;
  if (lowered === 'null') return null;

  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }

  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  return raw;
}

function ensureConfigFileOrExit(configPath: string, json: boolean): void {
  if (!existsSync(configPath)) {
    const msg = `Config file not found: ${configPath}. Run \`fiber-pay config init\` first.`;
    if (json) {
      printJsonError({
        code: 'CONFIG_NOT_FOUND',
        message: msg,
        recoverable: true,
        suggestion: 'Run `fiber-pay config init --network testnet` and retry.',
      });
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
  }
}

function normalizeHexScalarsForMutation(content: string): string {
  return content.replace(
    /^(\s*)(code_hash|tx_hash|args):\s*(0x[0-9a-fA-F]+)(\s*(#.*))?$/gm,
    (_match, indent: string, key: string, value: string, tail = '') =>
      `${indent}${key}: "${value}"${tail}`,
  );
}

function parseConfigDocumentForMutation(configPath: string) {
  const raw = readFileSync(configPath, 'utf-8');
  const normalized = normalizeHexScalarsForMutation(raw);
  return parseDocument(normalized, {
    keepSourceTokens: true,
  });
}

function collectConfigPaths(value: unknown, prefix = ''): string[] {
  if (value === null || value === undefined) {
    return prefix ? [prefix] : [];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return prefix ? [prefix] : [];
    }
    const result: string[] = [];
    for (let index = 0; index < value.length; index++) {
      const childPrefix = `${prefix}[${index}]`;
      result.push(...collectConfigPaths(value[index], childPrefix));
    }
    return result;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return prefix ? [prefix] : [];
    }
    const result: string[] = [];
    for (const [key, child] of entries) {
      const childPrefix = prefix ? `${prefix}.${key}` : key;
      result.push(...collectConfigPaths(child, childPrefix));
    }
    return result;
  }

  return prefix ? [prefix] : [];
}

export function createConfigCommand(_config: CliConfig): Command {
  const config = new Command('config').description('Single source configuration management');

  config
    .command('init')
    .option(
      '--data-dir <path>',
      'Target data directory (overrides FIBER_DATA_DIR for this command)',
    )
    .option('--network <network>', 'testnet | mainnet')
    .option('--rpc-port <port>', 'Override rpc.listening_addr port in generated config')
    .option('--p2p-port <port>', 'Override fiber.listening_addr port in generated config')
    .option('--proxy-port <port>', 'Set runtime proxy port and persist in profile.json')
    .option('--force', 'Overwrite existing config file')
    .option('--json')
    .action(async (options) => {
      const effective = getEffectiveConfig();
      const dataDir = options.dataDir ?? effective.config.dataDir;
      const selectedNetwork = options.network
        ? parseNetworkInput(options.network)
        : effective.config.network;
      const rpcPort = resolvePort(options.rpcPort, process.env.FIBER_RPC_PORT, 'rpc-port');
      const p2pPort = resolvePort(options.p2pPort, process.env.FIBER_P2P_PORT, 'p2p-port');
      const result = writeNetworkConfigFile(dataDir, selectedNetwork, {
        force: Boolean(options.force),
        rpcPort: rpcPort.value,
        p2pPort: p2pPort.value,
      });

      // Persist proxy port into profile.json if specified
      let proxyPort: number | undefined;
      if (options.proxyPort !== undefined) {
        proxyPort = parsePortInput(options.proxyPort, 'proxy-port');
        const existing = loadProfileConfig(dataDir) ?? {};
        existing.runtimeProxyListen = `127.0.0.1:${proxyPort}`;
        saveProfileConfig(dataDir, existing);
      }

      const payload = {
        configPath: result.path,
        dataDir,
        network: selectedNetwork,
        rpcPort: rpcPort.value,
        rpcPortSource: rpcPort.source,
        p2pPort: p2pPort.value,
        p2pPortSource: p2pPort.source,
        proxyPort: proxyPort ?? null,
        created: result.created,
        overwritten: result.overwritten,
        skipped: !result.created && !result.overwritten,
      };

      if (options.json) {
        printJsonSuccess(payload);
      } else {
        if (result.created) {
          console.log(`✅ Config initialized: ${result.path}`);
        } else if (result.overwritten) {
          console.log(`✅ Config overwritten: ${result.path}`);
        } else {
          console.log(`ℹ️  Config already exists: ${result.path}`);
          console.log('   Use --force to overwrite.');
        }
        if (options.dataDir !== undefined) {
          console.log(`   Data Dir: ${dataDir} (option)`);
        } else {
          console.log(`   Data Dir: ${dataDir} (${effective.sources.dataDir})`);
        }
        console.log(`   Network: ${selectedNetwork}`);
        if (rpcPort.value !== undefined)
          console.log(`   RPC Port: ${rpcPort.value} (${rpcPort.source})`);
        if (p2pPort.value !== undefined)
          console.log(`   P2P Port: ${p2pPort.value} (${p2pPort.source})`);
        if (proxyPort !== undefined) console.log(`   Proxy Port: ${proxyPort} (profile.json)`);
      }
    });

  config
    .command('show')
    .option('--effective', 'Debug resolved values and value source')
    .option('--json')
    .action(async (options) => {
      const effective = getEffectiveConfig();

      if (options.effective) {
        const payload = {
          config: effective.config,
          sources: effective.sources,
          configExists: effective.configExists,
        };

        if (options.json) {
          printJsonSuccess(payload);
        } else {
          console.log('Effective Config');
          console.log(`  Data Dir:    ${effective.config.dataDir} (${effective.sources.dataDir})`);
          console.log(`  Config Path: ${effective.config.configPath}`);
          console.log(`  Network:     ${effective.config.network} (${effective.sources.network})`);
          console.log(`  RPC URL:     ${effective.config.rpcUrl} (${effective.sources.rpcUrl})`);
          console.log(`  Exists:      ${effective.configExists ? 'yes' : 'no'}`);
        }
        return;
      }

      if (!effective.configExists) {
        if (options.json) {
          printJsonError({
            code: 'CONFIG_NOT_FOUND',
            message: `Config file not found: ${effective.config.configPath}`,
            recoverable: true,
            suggestion: 'Run `fiber-pay config init --network testnet` and retry.',
            details: { configPath: effective.config.configPath },
          });
        } else {
          console.error(`Error: Config file not found: ${effective.config.configPath}`);
          console.error('Run: fiber-pay config init --network testnet');
        }
        process.exit(1);
      }

      const content = readFileSync(effective.config.configPath, 'utf-8');
      const fileNetwork = parseNetworkFromConfig(content) || 'unknown';

      if (options.json) {
        printJsonSuccess({
          path: effective.config.configPath,
          network: fileNetwork,
          content,
        });
      } else {
        console.log(`# ${effective.config.configPath} (${fileNetwork})`);
        console.log(content);
      }
    });

  config
    .command('get')
    .description('Get config value by path (e.g. fiber.chain, ckb.udt_whitelist[0].name)')
    .argument('<path>', 'Config path')
    .option('--json')
    .action(async (path, options) => {
      const effective = getEffectiveConfig();
      const json = Boolean(options.json);
      const configPath = effective.config.configPath;
      ensureConfigFileOrExit(configPath, json);

      const doc = parseConfigDocumentForMutation(configPath);
      const segments = parseConfigPath(path);
      const value = doc.getIn(segments as (string | number)[]);

      if (value === undefined) {
        const msg = `Config path not found: ${resolveConfigPathAlias(path)}`;
        if (json) {
          printJsonError({
            code: 'CONFIG_PATH_NOT_FOUND',
            message: msg,
            recoverable: true,
            suggestion: 'Use `fiber-pay config list` to inspect available paths.',
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      if (json) {
        printJsonSuccess({ path: resolveConfigPathAlias(path), value });
      } else if (typeof value === 'object') {
        console.log(yamlStringify(value).trimEnd());
      } else {
        console.log(String(value));
      }
    });

  config
    .command('set')
    .description('Set config value by path (supports nested keys and array indexes)')
    .argument('<path>', 'Config path')
    .argument('<value>', 'New value')
    .option('--type <type>', 'auto|string|number|boolean|null|json', 'auto')
    .option('--json')
    .action(async (path, value, options) => {
      const effective = getEffectiveConfig();
      const json = Boolean(options.json);
      const configPath = effective.config.configPath;
      ensureConfigFileOrExit(configPath, json);

      const valueType = String(options.type ?? 'auto') as ConfigValueType;
      if (!['auto', 'string', 'number', 'boolean', 'null', 'json'].includes(valueType)) {
        const msg = `Invalid --type: ${options.type}. Expected auto|string|number|boolean|null|json`;
        if (json) {
          printJsonError({
            code: 'CONFIG_VALUE_TYPE_INVALID',
            message: msg,
            recoverable: true,
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      const doc = parseConfigDocumentForMutation(configPath);
      const resolvedPath = resolveConfigPathAlias(path);
      const segments = parseConfigPath(path);
      const parsedValue = parseTypedValue(value, valueType);

      doc.setIn(segments as (string | number)[], parsedValue);
      writeFileSync(configPath, doc.toString({ lineWidth: 0 }), 'utf-8');

      if (json) {
        printJsonSuccess({ path: resolvedPath, value: parsedValue, configPath });
      } else {
        console.log(`✅ Set ${resolvedPath} = ${value} in ${configPath}`);
      }
    });

  config
    .command('unset')
    .description('Remove config value by path')
    .argument('<path>', 'Config path')
    .option('--json')
    .action(async (path, options) => {
      const effective = getEffectiveConfig();
      const json = Boolean(options.json);
      const configPath = effective.config.configPath;
      ensureConfigFileOrExit(configPath, json);

      const doc = parseConfigDocumentForMutation(configPath);
      const resolvedPath = resolveConfigPathAlias(path);
      const segments = parseConfigPath(path);
      const removed = doc.deleteIn(segments as (string | number)[]);

      if (!removed) {
        const msg = `Config path not found: ${resolvedPath}`;
        if (json) {
          printJsonError({
            code: 'CONFIG_PATH_NOT_FOUND',
            message: msg,
            recoverable: true,
            suggestion: 'Use `fiber-pay config list` to inspect available paths.',
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      writeFileSync(configPath, doc.toString({ lineWidth: 0 }), 'utf-8');

      if (json) {
        printJsonSuccess({ path: resolvedPath, removed: true, configPath });
      } else {
        console.log(`✅ Removed ${resolvedPath} from ${configPath}`);
      }
    });

  config
    .command('list')
    .description('List config key paths (optionally under a prefix)')
    .option('--prefix <path>', 'List only under this path')
    .option('--json')
    .action(async (options) => {
      const effective = getEffectiveConfig();
      const json = Boolean(options.json);
      const configPath = effective.config.configPath;
      ensureConfigFileOrExit(configPath, json);

      const doc = parseConfigDocumentForMutation(configPath);
      const prefix = options.prefix ? resolveConfigPathAlias(String(options.prefix)) : undefined;

      let rootValue: unknown = doc.toJSON();
      let basePrefix = '';

      if (prefix) {
        const segments = parseConfigPath(prefix);
        rootValue = doc.getIn(segments as (string | number)[]);
        if (rootValue === undefined) {
          const msg = `Config path not found: ${prefix}`;
          if (json) {
            printJsonError({
              code: 'CONFIG_PATH_NOT_FOUND',
              message: msg,
              recoverable: true,
              suggestion: 'Use `fiber-pay config list` without prefix first.',
            });
          } else {
            console.error(`Error: ${msg}`);
          }
          process.exit(1);
        }
        basePrefix = prefix;
      }

      const paths = collectConfigPaths(rootValue, basePrefix).sort((a, b) => a.localeCompare(b));

      if (json) {
        printJsonSuccess({ prefix: prefix ?? null, paths, count: paths.length });
      } else {
        for (const path of paths) {
          console.log(path);
        }
      }
    });

  // ---------------------------------------------------------------------------
  // config profile — manage profile.json key-value settings
  // ---------------------------------------------------------------------------
  const profile = new Command('profile').description(
    'Manage profile.json settings (CLI-only overrides)',
  );

  const PROFILE_KEYS: (keyof ProfileConfig)[] = ['binaryPath', 'keyPassword', 'runtimeProxyListen'];

  profile
    .command('show')
    .description('Show current profile.json values')
    .option('--json')
    .action(async (options) => {
      const effective = getEffectiveConfig();
      const profileData = loadProfileConfig(effective.config.dataDir);

      if (options.json) {
        printJsonSuccess({ dataDir: effective.config.dataDir, profile: profileData ?? {} });
      } else {
        if (!profileData || Object.keys(profileData).length === 0) {
          console.log('No profile settings found.');
          console.log(`  Location: ${effective.config.dataDir}/profile.json`);
          return;
        }
        console.log('Profile Settings');
        console.log(`  Location: ${effective.config.dataDir}/profile.json`);
        for (const key of PROFILE_KEYS) {
          if (profileData[key] !== undefined) {
            console.log(`  ${key}: ${profileData[key]}`);
          }
        }
      }
    });

  profile
    .command('list')
    .description('List all available Fiber profiles')
    .option('--json')
    .action(async (options) => {
      const homeDir = homedir();
      const profilesDir = join(homeDir, '.fiber-pay', 'profiles');
      const defaultDir = join(homeDir, '.fiber-pay');
      const defaultConfigPath = join(defaultDir, 'config.yml');

      const profiles: string[] = [];
      const hasDefaultConfig = existsSync(defaultConfigPath);

      if (hasDefaultConfig) {
        profiles.push('default');
      }

      if (existsSync(profilesDir)) {
        try {
          const entries = readdirSync(profilesDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== 'default') {
              profiles.push(entry.name);
            }
          }
        } catch (error) {
          if (options.json) {
            printJsonError({
              code: 'PROFILE_LIST_ERROR',
              message: `Failed to read profiles directory: ${error instanceof Error ? error.message : String(error)}`,
              recoverable: true,
            });
            process.exit(1);
          } else {
            console.error(
              `Warning: Could not read profiles directory: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }

      profiles.sort((a, b) => {
        if (a === 'default') return -1;
        if (b === 'default') return 1;
        return a.localeCompare(b);
      });

      if (options.json) {
        printJsonSuccess({ profiles, count: profiles.length });
      } else {
        if (profiles.length === 0) {
          console.log('No profiles found.');
        } else {
          for (const profileName of profiles) {
            console.log(profileName);
          }
        }
      }
    });

  profile
    .command('set')
    .description('Set a profile key')
    .argument('<key>', `One of: ${PROFILE_KEYS.join(', ')}`)
    .argument('<value>')
    .option('--json')
    .action(async (key, value, options) => {
      if (!PROFILE_KEYS.includes(key as keyof ProfileConfig)) {
        const msg = `Unknown profile key: ${key}. Valid keys: ${PROFILE_KEYS.join(', ')}`;
        if (options.json) {
          printJsonError({
            code: 'PROFILE_INVALID_KEY',
            message: msg,
            recoverable: true,
            suggestion: `Use one of: ${PROFILE_KEYS.join(', ')}`,
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      const effective = getEffectiveConfig();
      const existing = loadProfileConfig(effective.config.dataDir) ?? {};

      (existing as Record<string, unknown>)[key] = value;
      saveProfileConfig(effective.config.dataDir, existing);

      if (options.json) {
        printJsonSuccess({ key, value, dataDir: effective.config.dataDir });
      } else {
        console.log(`✅ Profile key "${key}" set to "${value}"`);
      }
    });

  profile
    .command('unset')
    .description('Remove a profile key')
    .argument('<key>', `One of: ${PROFILE_KEYS.join(', ')}`)
    .option('--json')
    .action(async (key, options) => {
      if (!PROFILE_KEYS.includes(key as keyof ProfileConfig)) {
        const msg = `Unknown profile key: ${key}. Valid keys: ${PROFILE_KEYS.join(', ')}`;
        if (options.json) {
          printJsonError({
            code: 'PROFILE_INVALID_KEY',
            message: msg,
            recoverable: true,
            suggestion: `Use one of: ${PROFILE_KEYS.join(', ')}`,
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      const effective = getEffectiveConfig();
      const existing = loadProfileConfig(effective.config.dataDir) ?? {};
      delete (existing as Record<string, unknown>)[key];
      saveProfileConfig(effective.config.dataDir, existing);

      if (options.json) {
        printJsonSuccess({ key, removed: true, dataDir: effective.config.dataDir });
      } else {
        console.log(`✅ Profile key "${key}" removed`);
      }
    });

  config.addCommand(profile);

  return config;
}
