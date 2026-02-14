/**
 * Utility Functions
 * Common utilities for hex conversion, CKB amount calculation, and random generation
 */

import type { HexString } from './types/index.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Convert number to hex string
 */
export function toHex(value: number | bigint): HexString {
  return `0x${value.toString(16)}`;
}

/**
 * Convert hex string to bigint
 */
export function fromHex(hex: HexString): bigint {
  return BigInt(hex);
}

/**
 * Convert CKB amount (in CKB units) to shannons (hex)
 */
export function ckbToShannons(ckb: number | string): HexString {
  const amount = typeof ckb === 'string' ? parseFloat(ckb) : ckb;
  const shannons = BigInt(Math.floor(amount * 1e8));
  return toHex(shannons);
}

/**
 * Convert shannons (hex) to CKB amount
 */
export function shannonsToCkb(shannons: HexString): number {
  return Number(fromHex(shannons)) / 1e8;
}

/**
 * Generate a random 32-byte hex string (for payment preimage)
 */
export function randomBytes32(): HexString {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;
}

function base58btcEncode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  let number = 0n;
  for (const byte of bytes) {
    number = (number << 8n) + BigInt(byte);
  }

  let encoded = '';
  while (number > 0n) {
    const remainder = Number(number % 58n);
    encoded = BASE58_ALPHABET[remainder] + encoded;
    number /= 58n;
  }

  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    encoded = `1${encoded}`;
  }

  return encoded || '1';
}

/**
 * Convert a Fiber node id (hex-encoded compressed secp256k1 pubkey, 33 bytes)
 * to a libp2p peer id (base58btc encoded sha2-256 multihash).
 */
export async function nodeIdToPeerId(nodeId: string): Promise<string> {
  const normalized = nodeId.trim().replace(/^0x/i, '');

  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error('Invalid node id: expected hex string');
  }
  if (normalized.length !== 66) {
    throw new Error(
      `Invalid node id: expected 33-byte compressed pubkey, got ${normalized.length / 2} bytes`,
    );
  }

  const raw = Uint8Array.from(
    normalized.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );

  if (raw.length !== 33) {
    throw new Error(`Invalid node id: expected 33-byte compressed pubkey, got ${raw.length} bytes`);
  }

  const digestBuffer = await crypto.subtle.digest('SHA-256', raw);
  const digest = new Uint8Array(digestBuffer);
  const multihash = new Uint8Array(2 + digest.length);
  multihash[0] = 0x12;
  multihash[1] = 0x20;
  multihash.set(digest, 2);

  return base58btcEncode(multihash);
}

/**
 * Build a canonical multiaddr by appending/replacing /p2p/<peerId>.
 */
export function buildMultiaddr(address: string, peerId: string): string {
  const normalizedAddress = address.trim();
  const normalizedPeerId = peerId.trim();

  if (!normalizedAddress.startsWith('/')) {
    throw new Error('Invalid multiaddr: expected address starting with "/"');
  }
  if (!normalizedPeerId) {
    throw new Error('Invalid peer id: empty value');
  }

  const withoutPeerSuffix = normalizedAddress.replace(/\/p2p\/[^/]+$/, '');
  return `${withoutPeerSuffix}/p2p/${normalizedPeerId}`;
}

/**
 * Build a canonical multiaddr from a node id and base address.
 */
export async function buildMultiaddrFromNodeId(address: string, nodeId: string): Promise<string> {
  const peerId = await nodeIdToPeerId(nodeId);
  return buildMultiaddr(address, peerId);
}
