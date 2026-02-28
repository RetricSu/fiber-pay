/**
 * Process Manager
 * Manages the lifecycle of the Fiber Network Node (fnn) binary
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as yaml from './yaml.js';

// =============================================================================
// Types
// =============================================================================

export interface FiberNodeConfig {
  /** Path to the fnn binary */
  binaryPath: string;
  /** Base directory for data storage */
  dataDir: string;
  /** Path to the config file (optional - will use built-in testnet config if not provided) */
  configFilePath?: string;
  /** Fiber P2P listening address */
  fiberListeningAddr?: string;
  /** Fiber node name */
  nodeName?: string;
  /** Bootstrap node addresses */
  bootnodeAddrs?: string[];
  /** CKB RPC URL */
  ckbRpcUrl?: string;
  /** RPC listening address */
  rpcListeningAddr?: string;
  /** Chain configuration (mainnet, testnet, or file path) */
  chain?: 'mainnet' | 'testnet' | string;
  /** Key encryption password */
  keyPassword?: string;
  /** Log level */
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  /** UDT whitelist */
  udtWhitelist?: Array<{
    name: string;
    script: {
      code_hash: string;
      hash_type: 'type' | 'data' | 'data1' | 'data2';
      args: string;
    };
  }>;
}

export interface ProcessManagerEvents {
  started: () => void;
  stopped: (code: number | null, signal: NodeJS.Signals | null) => void;
  error: (error: Error) => void;
  stdout: (data: string) => void;
  stderr: (data: string) => void;
  ready: () => void;
}

export type ProcessState = 'stopped' | 'starting' | 'running' | 'stopping';

const DEFAULT_TESTNET_FIBER_CONFIG = {
  listening_addr: '/ip4/0.0.0.0/tcp/8228',
  bootnode_addrs: [
    '/ip4/54.179.226.154/tcp/8228/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy',
    '/ip4/16.163.7.105/tcp/8228/p2p/QmdyQWjPtbK4NWWsvy8s69NGJaQULwgeQDT5ZpNDrTNaeV',
  ],
  announce_listening_addr: true,
  chain: 'testnet',
  scripts: [
    {
      name: 'FundingLock',
      script: {
        code_hash: '0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c',
        hash_type: 'type',
        args: '0x',
      },
      cell_deps: [
        {
          type_id: {
            code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
            hash_type: 'type',
            args: '0x3cb7c0304fe53f75bb5727e2484d0beae4bd99d979813c6fc97c3cca569f10f6',
          },
        },
        {
          cell_dep: {
            out_point: {
              tx_hash: '0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7',
              index: '0x0',
            },
            dep_type: 'code',
          },
        },
      ],
    },
    {
      name: 'CommitmentLock',
      script: {
        code_hash: '0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8',
        hash_type: 'type',
        args: '0x',
      },
      cell_deps: [
        {
          type_id: {
            code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
            hash_type: 'type',
            args: '0xf7e458887495cf70dd30d1543cad47dc1dfe9d874177bf19291e4db478d5751b',
          },
        },
        {
          cell_dep: {
            out_point: {
              tx_hash: '0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7',
              index: '0x0',
            },
            dep_type: 'code',
          },
        },
      ],
    },
  ],
} as const;

// =============================================================================
// Process Manager
// =============================================================================

export class ProcessManager extends EventEmitter {
  private config: FiberNodeConfig;
  private process: ChildProcess | null = null;
  private state: ProcessState = 'stopped';
  private configPath: string;
  private stdoutBuffer: string[] = [];
  private stderrBuffer: string[] = [];
  private maxBufferSize = 1000;

  constructor(config: FiberNodeConfig) {
    super();
    this.config = config;
    this.configPath = join(config.dataDir, 'config.yml');
  }

  /**
   * Get current process state
   */
  getState(): ProcessState {
    return this.state;
  }

  /**
   * Check if the process is running
   */
  isRunning(): boolean {
    return this.state === 'running' || this.state === 'starting';
  }

  /**
   * Start the Fiber node
   */
  async start(): Promise<void> {
    if (this.isRunning()) {
      throw new Error('Node is already running');
    }

    this.state = 'starting';

    // Ensure data directory exists
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true });
    }

    // Copy or generate config file
    await this.ensureConfigFile();

    // Build environment variables
    const env: Record<string, string> = {
      ...process.env,
      RUST_LOG: this.config.logLevel || 'info',
    };

    // FIBER_SECRET_KEY_PASSWORD is always required by the fiber node
    // Use the provided password or generate a default one
    env.FIBER_SECRET_KEY_PASSWORD = this.config.keyPassword || 'fiber-pay-default-key';

    // Spawn the process
    const args = ['-c', this.configPath, '-d', this.config.dataDir];

    this.process = spawn(this.config.binaryPath, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    // Handle stdout
    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.stdoutBuffer.push(text);
      if (this.stdoutBuffer.length > this.maxBufferSize) {
        this.stdoutBuffer.shift();
      }
      this.emit('stdout', text);

      // Check for ready signal
      if (text.includes('RPC server started') || text.includes('listening on')) {
        if (this.state === 'starting') {
          this.state = 'running';
          this.emit('ready');
        }
      }
    });

    // Handle stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.stderrBuffer.push(text);
      if (this.stderrBuffer.length > this.maxBufferSize) {
        this.stderrBuffer.shift();
      }
      this.emit('stderr', text);
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.state = 'stopped';
      this.process = null;
      this.emit('stopped', code, signal);
    });

    // Handle process error
    this.process.on('error', (error) => {
      this.state = 'stopped';
      this.process = null;
      this.emit('error', error);
    });

    this.emit('started');

    // Wait a bit for the process to initialize
    await new Promise((resolve) => setTimeout(resolve, 500));

    // If process died immediately, throw error
    // State may have changed due to async event handlers
    if ((this.state as ProcessState) === 'stopped') {
      throw new Error('Process exited immediately. Check logs.');
    }
  }

  /**
   * Stop the Fiber node
   */
  async stop(timeout = 10000): Promise<void> {
    if (!this.process || this.state === 'stopped') {
      return;
    }

    this.state = 'stopping';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Force kill if graceful shutdown fails
        this.process?.kill('SIGKILL');
      }, timeout);

      this.once('stopped', () => {
        clearTimeout(timer);
        resolve();
      });

      this.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      // Send SIGTERM for graceful shutdown
      this.process?.kill('SIGTERM');
    });
  }

  /**
   * Restart the Fiber node
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Get recent stdout output
   */
  getStdout(lines?: number): string[] {
    if (lines) {
      return this.stdoutBuffer.slice(-lines);
    }
    return [...this.stdoutBuffer];
  }

  /**
   * Get recent stderr output
   */
  getStderr(lines?: number): string[] {
    if (lines) {
      return this.stderrBuffer.slice(-lines);
    }
    return [...this.stderrBuffer];
  }

  /**
   * Get the RPC URL for this node
   */
  getRpcUrl(): string {
    const addr = this.config.rpcListeningAddr || '127.0.0.1:8227';
    return `http://${addr}`;
  }

  /**
   * Wait for the node to be ready
   */
  waitForReady(timeout = 60000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.state === 'running') {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        this.off('ready', onReady);
        this.off('stopped', onStopped);
        reject(new Error('Timeout waiting for node to be ready'));
      }, timeout);

      const onReady = () => {
        clearTimeout(timer);
        this.off('stopped', onStopped);
        resolve();
      };

      const onStopped = () => {
        clearTimeout(timer);
        this.off('ready', onReady);
        reject(new Error('Node stopped while waiting for ready'));
      };

      this.once('ready', onReady);
      this.once('stopped', onStopped);
    });
  }

  /**
   * Ensure the config file exists (copy from source or generate)
   */
  private async ensureConfigFile(): Promise<void> {
    const configDir = dirname(this.configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // If a config file path is provided, copy it
    if (this.config.configFilePath && existsSync(this.config.configFilePath)) {
      // Copy the config file to the data directory
      const sourceContent = readFileSync(this.config.configFilePath, 'utf-8');
      writeFileSync(this.configPath, sourceContent);
      return;
    }

    // Otherwise, generate a basic config file
    this.generateConfigFile();
  }

  /**
   * Generate the config file (fallback when no source config provided)
   */
  private generateConfigFile(): void {
    const chain = this.config.chain || 'testnet';
    const useDefaultTestnetConfig = chain === 'testnet';
    const config: Record<string, unknown> = {
      fiber: useDefaultTestnetConfig
        ? { ...DEFAULT_TESTNET_FIBER_CONFIG }
        : {
            listening_addr: this.config.fiberListeningAddr || '/ip4/127.0.0.1/tcp/8228',
            announce_listening_addr: true,
            chain,
          },
      rpc: {
        listening_addr: this.config.rpcListeningAddr || '127.0.0.1:8227',
      },
      ckb: {
        rpc_url: this.config.ckbRpcUrl || 'https://testnet.ckbapp.dev/',
      },
      services: ['fiber', 'rpc', 'ckb'],
    };

    if (this.config.nodeName) {
      (config.fiber as Record<string, unknown>).announced_node_name = this.config.nodeName;
    }

    if (this.config.bootnodeAddrs?.length) {
      (config.fiber as Record<string, unknown>).bootnode_addrs = this.config.bootnodeAddrs;
    }

    if (this.config.udtWhitelist?.length) {
      (config.ckb as Record<string, unknown>).udt_whitelist = this.config.udtWhitelist;
    }

    const configDir = dirname(this.configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    writeFileSync(this.configPath, yaml.stringify(config));
  }
}
