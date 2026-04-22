import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentProxy,
  isDeniedAddress,
  resolveAndCheckDenied,
  SHIM_PLACEHOLDER,
} from './agent-proxy.js';

// ---------------------------------------------------------------------------
// isDeniedAddress — synchronous CIDR check
// ---------------------------------------------------------------------------

describe('isDeniedAddress', () => {
  describe('IPv4 denied addresses', () => {
    it('denies loopback 127.0.0.1', () => {
      expect(isDeniedAddress('127.0.0.1')).toBe(true);
    });

    it('denies loopback 127.255.255.255', () => {
      expect(isDeniedAddress('127.255.255.255')).toBe(true);
    });

    it('denies RFC-1918 10.x.x.x', () => {
      expect(isDeniedAddress('10.0.0.1')).toBe(true);
      expect(isDeniedAddress('10.255.255.255')).toBe(true);
    });

    it('denies RFC-1918 172.16.x.x through 172.31.x.x', () => {
      expect(isDeniedAddress('172.16.0.1')).toBe(true);
      expect(isDeniedAddress('172.31.255.255')).toBe(true);
    });

    it('allows 172.32.0.1 (outside RFC-1918 /12)', () => {
      expect(isDeniedAddress('172.32.0.1')).toBe(false);
    });

    it('denies RFC-1918 192.168.x.x', () => {
      expect(isDeniedAddress('192.168.0.1')).toBe(true);
      expect(isDeniedAddress('192.168.255.255')).toBe(true);
    });

    it('denies link-local 169.254.x.x', () => {
      expect(isDeniedAddress('169.254.1.1')).toBe(true);
    });

    it('denies 0.0.0.0/8', () => {
      expect(isDeniedAddress('0.0.0.0')).toBe(true);
      expect(isDeniedAddress('0.255.255.255')).toBe(true);
    });
  });

  describe('IPv4 allowed addresses', () => {
    it('allows public IP 8.8.8.8', () => {
      expect(isDeniedAddress('8.8.8.8')).toBe(false);
    });

    it('allows public IP 1.1.1.1', () => {
      expect(isDeniedAddress('1.1.1.1')).toBe(false);
    });

    it('allows public IP 203.0.113.1', () => {
      expect(isDeniedAddress('203.0.113.1')).toBe(false);
    });
  });

  describe('IPv6 denied addresses', () => {
    it('denies loopback ::1', () => {
      expect(isDeniedAddress('::1')).toBe(true);
    });

    it('denies unique local fc00::', () => {
      expect(isDeniedAddress('fc00::1')).toBe(true);
    });

    it('denies unique local fd00::', () => {
      expect(isDeniedAddress('fd12::1')).toBe(true);
    });

    it('denies link-local fe80::', () => {
      expect(isDeniedAddress('fe80::1')).toBe(true);
    });
  });

  describe('IPv6 allowed addresses', () => {
    it('allows public IPv6 2001:db8::1', () => {
      expect(isDeniedAddress('2001:db8::1')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for invalid IP', () => {
      expect(isDeniedAddress('not-an-ip')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isDeniedAddress('')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveAndCheckDenied — async DNS resolve + check
// ---------------------------------------------------------------------------

describe('resolveAndCheckDenied', () => {
  it('denies raw loopback IP without DNS lookup', async () => {
    expect(await resolveAndCheckDenied('127.0.0.1')).toBe(true);
  });

  it('denies raw private IP without DNS lookup', async () => {
    expect(await resolveAndCheckDenied('10.0.0.5')).toBe(true);
  });

  it('denies localhost (resolves to 127.0.0.1)', async () => {
    expect(await resolveAndCheckDenied('localhost')).toBe(true);
  });

  it('allows a public hostname', async () => {
    // dns.google resolves to 8.8.8.8 / 8.8.4.4
    expect(await resolveAndCheckDenied('dns.google')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AgentProxy — integration tests
// ---------------------------------------------------------------------------

describe('AgentProxy', () => {
  let proxy: AgentProxy;

  afterEach(async () => {
    if (proxy) await proxy.stop();
  });

  it('starts and stops without error', async () => {
    proxy = new AgentProxy({
      port: 0,
      host: '127.0.0.1',
      hostAddr: '127.0.0.1',
      apiKeys: {},
    });
    await proxy.start();
    await proxy.stop();
  });

  it('responds to /health', async () => {
    proxy = new AgentProxy({
      port: 0,
      host: '127.0.0.1',
      hostAddr: '127.0.0.1',
      apiKeys: {},
    });
    await proxy.start();

    const response = await fetch(`${proxy.proxyUrl}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('returns 404 for unknown routes', async () => {
    proxy = new AgentProxy({
      port: 0,
      host: '127.0.0.1',
      hostAddr: '127.0.0.1',
      apiKeys: {},
    });
    await proxy.start();

    const response = await fetch(`${proxy.proxyUrl}/unknown`);
    expect(response.status).toBe(404);
  });

  describe('buildContainerEnv', () => {
    it('includes fake API keys and proxy URLs', () => {
      proxy = new AgentProxy({
        port: 8111,
        hostAddr: '192.168.1.100',
        apiKeys: {
          anthropic: 'real-anthropic-key',
          openai: 'real-openai-key',
        },
      });

      const env = proxy.buildContainerEnv();

      expect(env.ANTHROPIC_API_KEY).toBe(SHIM_PLACEHOLDER);
      expect(env.OPENAI_API_KEY).toBe(SHIM_PLACEHOLDER);
      expect(env.ANTHROPIC_BASE_URL).toBe('http://192.168.1.100:8111/anthropic');
      expect(env.OPENAI_BASE_URL).toBe('http://192.168.1.100:8111/openai');
      expect(env.HTTP_PROXY).toBe('http://192.168.1.100:8111');
      expect(env.HTTPS_PROXY).toBe('http://192.168.1.100:8111');
      expect(env.HOME).toBe('/home/boxlite');
    });

    it('omits keys that are not provided', () => {
      proxy = new AgentProxy({
        port: 8111,
        hostAddr: '192.168.1.100',
        apiKeys: { anthropic: 'real-key' },
      });

      const env = proxy.buildContainerEnv();

      expect(env.ANTHROPIC_API_KEY).toBe(SHIM_PLACEHOLDER);
      expect(env.ANTHROPIC_BASE_URL).toBeDefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.OPENAI_BASE_URL).toBeUndefined();
    });
  });

  describe('buildOpenCodeConfig', () => {
    it('generates valid JSON with provider base URLs', () => {
      proxy = new AgentProxy({
        port: 8111,
        hostAddr: '10.0.0.1',
        apiKeys: {
          anthropic: 'real-key',
          openai: 'real-key',
        },
      });

      const config = JSON.parse(proxy.buildOpenCodeConfig()) as {
        provider: Record<string, { options: { baseURL: string } }>;
      };

      expect(config.provider.anthropic.options.baseURL).toBe('http://10.0.0.1:8111/anthropic');
      expect(config.provider.openai.options.baseURL).toBe('http://10.0.0.1:8111/openai');
    });
  });

  describe('CONNECT tunnel deny-list', () => {
    async function sendConnect(proxyUrl: string, target: string): Promise<string> {
      const { connect: netConnect } = await import('node:net');
      const url = new URL(proxyUrl);

      return new Promise<string>((resolve, reject) => {
        const socket = netConnect(Number(url.port), url.hostname, () => {
          socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
        });
        let data = '';
        socket.on('data', (chunk) => {
          data += chunk.toString();
          if (data.includes('\r\n\r\n') || data.includes('\n\n')) {
            socket.destroy();
            resolve(data);
          }
        });
        socket.on('error', reject);
        socket.on('close', () => resolve(data));
      });
    }

    it('denies CONNECT to 127.0.0.1', async () => {
      proxy = new AgentProxy({
        port: 0,
        host: '127.0.0.1',
        hostAddr: '127.0.0.1',
        apiKeys: {},
      });
      await proxy.start();

      const result = await sendConnect(proxy.proxyUrl, '127.0.0.1:8080');
      expect(result).toContain('403');
      expect(result).toContain('denied');
    });

    it('denies CONNECT to 10.0.0.1', async () => {
      proxy = new AgentProxy({
        port: 0,
        host: '127.0.0.1',
        hostAddr: '127.0.0.1',
        apiKeys: {},
      });
      await proxy.start();

      const result = await sendConnect(proxy.proxyUrl, '10.0.0.1:8080');
      expect(result).toContain('403');
    });

    it('denies CONNECT to localhost', async () => {
      proxy = new AgentProxy({
        port: 0,
        host: '127.0.0.1',
        hostAddr: '127.0.0.1',
        apiKeys: {},
      });
      await proxy.start();

      const result = await sendConnect(proxy.proxyUrl, 'localhost:8080');
      expect(result).toContain('403');
    });

    it('denies CONNECT to 192.168.x.x', async () => {
      proxy = new AgentProxy({
        port: 0,
        host: '127.0.0.1',
        hostAddr: '127.0.0.1',
        apiKeys: {},
      });
      await proxy.start();

      const result = await sendConnect(proxy.proxyUrl, '192.168.1.1:80');
      expect(result).toContain('403');
    });
  });
});
