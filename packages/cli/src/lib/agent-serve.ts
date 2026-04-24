/**
 * Agent Serve — L402-gated AI Agent HTTP Service
 *
 * Starts an Express server that:
 * 1. Gates all requests behind L402 payment via createL402Middleware()
 * 2. On paid POST /, runs `acpx <agent> exec --format quiet '<prompt>'` inside a BoxLite sandbox
 * 3. Returns either JSON (default) or SSE stream (`stream: "sse"` or Accept header)
 *
 * ## Per-session namespace isolation
 *
 * Each request is wrapped with `unshare --user --pid --mount` (Linux namespaces) so that
 * the agent process gets a private view of the filesystem and cannot enumerate or access
 * other sessions' workspaces or processes:
 *
 *   - `/workspace` is bind-mounted to `/workspace/sessions/<sessionId>/` inside the namespace
 *   - `/tmp` is bind-mounted to `/tmp/fiber-sessions/<sessionId>/` inside the namespace
 *   - PID namespace: agent cannot see other sessions' processes via `ps` or `/proc`
 *   - User namespace: virtual root inside the namespace (no real privilege escalation)
 *
 * Isolation is mandatory and probed at startup. If the kernel does not support
 * unprivileged namespaces, startup aborts immediately.
 *
 * Run `scripts/boxlite-setup.sh` inside the BoxLite Alpine container once to install
 * `util-linux` (full-featured `unshare`) and create the required base directories.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { extname, posix as pathPosix } from 'node:path';
import type { Currency } from '@fiber-pay/sdk';
import { createL402Middleware, FiberRpcClient } from '@fiber-pay/sdk/node';
import cors from 'cors';
import express from 'express';
import { AgentProxy } from './agent-proxy.js';
import { BoxliteClient, BoxliteError } from './boxlite-client.js';
import type { CliConfig } from './config.js';
import { printJsonError, printJsonSuccess } from './format.js';

export interface AgentServeOptions {
  agent: string;
  port: string;
  host: string;
  price: string;
  rootKey?: string;
  expiry: string;
  cwd?: string;
  approveAll?: boolean;
  timeout: string;
  format?: string;
  boxliteUrl?: string;
  boxliteBoxId?: string;
  json?: boolean;
  /** How long (in hours) to keep a named session workspace before auto-cleanup. */
  workspaceTtlHours?: string;
  /** Commander maps --workspace-ttl to workspaceTtl at runtime. */
  workspaceTtl?: string;
  /** Minimum free space (in MB) required on /workspace before accepting a new session. */
  workspaceMinFreeMb?: string;
  /** Port for the host-side proxy (default 8111). */
  proxyPort?: string;
  /** Address the container uses to reach the host (auto-detected if omitted). */
  proxyHostAddr?: string;
  /** Set to false via --no-proxy to disable the host-side proxy. */
  proxy?: boolean;
}

interface AgentServeRequest extends express.Request {
  l402?: { valid?: boolean; paymentHash?: string; preimage?: string };
  _fiberPayRequestId?: number;
}

interface SessionCredentials {
  sessionId: string;
  sessionToken: string;
  created: boolean;
}

interface SessionTokenPayload {
  v: 1;
  sid: string;
  iat: number;
  exp: number;
}

interface WorkspaceStaticFile {
  content: Buffer;
  sizeBytes: number;
  mtimeEpochSeconds: number;
}

interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink';
  sizeBytes: number;
  mtimeEpochSeconds: number;
}

interface WorkspaceDirectoryListing {
  path: string;
  entries: WorkspaceDirectoryEntry[];
  truncated: boolean;
}

type WorkspaceStaticReadResult =
  | { ok: true; file: WorkspaceStaticFile }
  | {
      ok: false;
      code:
        | 'SESSION_NOT_FOUND'
        | 'NOT_FOUND'
        | 'PATH_OUTSIDE_SESSION'
        | 'TOO_LARGE'
        | 'EXEC_FAILED';
      sizeBytes?: number;
      message?: string;
    };

type WorkspaceDirectoryListResult =
  | { ok: true; listing: WorkspaceDirectoryListing }
  | {
      ok: false;
      code:
        | 'SESSION_NOT_FOUND'
        | 'NOT_FOUND'
        | 'NOT_DIRECTORY'
        | 'PATH_OUTSIDE_SESSION'
        | 'EXEC_FAILED';
      message?: string;
    };

const SESSION_TOKEN_PREFIX = 'fpst';
const MIN_SESSION_TOKEN_TTL_SECONDS = 300;
const MAX_STATIC_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DIRECTORY_LIST_ENTRIES = 500;
const RECONNECT_PATTERN = /agent needs reconnect/i;
const SECCOMP_NOT_AVAILABLE_PATTERN = /\bseccomp\b.*\bnot available\b/i;

const STATIC_CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function getClientIp(req: AgentServeRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof forwardedValue === 'string' && forwardedValue.trim().length > 0) {
    return forwardedValue.split(',')[0]?.trim() || 'unknown';
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
}

function summarizeL402Status(req: AgentServeRequest): string {
  if (req.l402?.valid) {
    if (req.l402.paymentHash) {
      return `payment-verified:${req.l402.paymentHash.slice(0, 14)}...`;
    }
    if (req.l402.preimage) {
      return 'payment-verified:preimage';
    }
    return 'payment-verified';
  }

  return 'no-l402-token';
}

function getRequestId(req: AgentServeRequest): number {
  return req._fiberPayRequestId ?? 0;
}

function shouldUseSse(req: AgentServeRequest): boolean {
  const streamMode = req.body?.stream;
  if (streamMode === true || streamMode === 'sse') {
    return true;
  }

  const acceptHeader = req.headers.accept;
  if (typeof acceptHeader !== 'string') {
    return false;
  }

  return acceptHeader.includes('text/event-stream');
}

function parseJsonLines(text: string): Array<Record<string, unknown>> | undefined {
  try {
    return text
      .trim()
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return undefined;
  }
}

/**
 * Build the environment variables passed into the BoxLite container.
 *
 * When `proxyEnv` is provided (the proxy is enabled), the container receives:
 *   - Fake API keys (`fp-shim-placeholder`)
 *   - `*_BASE_URL` pointing to the host proxy's reverse-proxy routes
 *   - `HTTP_PROXY` / `HTTPS_PROXY` for outbound traffic filtering
 *
 * When `proxyEnv` is `undefined` (proxy disabled via `--no-proxy`),
 * real API keys from the host process are passed through directly.
 */
function buildSafeEnv(proxyEnv?: Record<string, string>): Record<string, string> {
  if (proxyEnv) {
    return { ...proxyEnv };
  }

  // Fallback: no proxy — pass real keys (less secure, for debugging only).
  const allowed = [
    'PATH',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'KIMI_API_KEY',
    'OPENCODE_API_KEY',
    'GEMINI_API_KEY',
  ];
  const env: Record<string, string> = { HOME: '/home/boxlite' };
  for (const key of allowed) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key] as string;
    }
  }
  return env;
}

// ---------------------------------------------------------------------------
// Linux namespace isolation helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize an arbitrary session ID string into a safe filesystem path component.
 * Replaces any character that is not alphanumeric, hyphen, or underscore with
 * a hyphen, then truncates to 64 characters.
 */
function sanitizeSessionId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9\-_]/g, '-').slice(0, 64);
}

function isIgnorableAcpxStderrLine(line: string): boolean {
  const normalized = line.trim();
  if (normalized.length === 0) {
    return false;
  }

  return RECONNECT_PATTERN.test(normalized) || SECCOMP_NOT_AVAILABLE_PATTERN.test(normalized);
}

function hasOnlyIgnorableAcpxStderr(stderr: string): boolean {
  const nonEmptyLines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (nonEmptyLines.length === 0) {
    return false;
  }

  return nonEmptyLines.every((line) => isIgnorableAcpxStderrLine(line));
}

/**
 * Single-quote a string for safe embedding in a POSIX sh -c script.
 * Handles embedded single-quotes via the '\'' escape sequence.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}' `;
}

function encodeBase64Url(data: Buffer | string): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9\-_]+$/.test(value)) {
    return undefined;
  }

  const padding = (4 - (value.length % 4)) % 4;
  const base64 = `${value}${'='.repeat(padding)}`.replace(/-/g, '+').replace(/_/g, '/');

  try {
    return Buffer.from(base64, 'base64');
  } catch {
    return undefined;
  }
}

function sessionTokenSignature(payloadPart: string, secret: Buffer): string {
  return encodeBase64Url(createHmac('sha256', secret).update(payloadPart).digest());
}

function mintSessionToken(sessionId: string, secret: Buffer, ttlSeconds: number): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: SessionTokenPayload = {
    v: 1,
    sid: sessionId,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };
  const payloadPart = encodeBase64Url(JSON.stringify(payload));
  const signaturePart = sessionTokenSignature(payloadPart, secret);
  return `${SESSION_TOKEN_PREFIX}.${payloadPart}.${signaturePart}`;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isValidSessionId(sessionId: string): boolean {
  if (sessionId.length === 0 || sessionId.length > 64) {
    return false;
  }

  return sanitizeSessionId(sessionId) === sessionId;
}

function verifySessionToken(
  sessionId: string,
  token: string,
  secret: Buffer,
): { valid: true } | { valid: false; reason: string } {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== SESSION_TOKEN_PREFIX) {
    return { valid: false, reason: 'Invalid session token format.' };
  }

  const payloadPart = parts[1] || '';
  const signaturePart = parts[2] || '';
  if (payloadPart.length === 0 || signaturePart.length === 0) {
    return { valid: false, reason: 'Invalid session token format.' };
  }

  const expectedSignature = sessionTokenSignature(payloadPart, secret);
  if (!timingSafeStringEqual(signaturePart, expectedSignature)) {
    return { valid: false, reason: 'Session token signature mismatch.' };
  }

  const payloadBuffer = decodeBase64Url(payloadPart);
  if (!payloadBuffer) {
    return { valid: false, reason: 'Invalid session token payload encoding.' };
  }

  let payload: SessionTokenPayload;
  try {
    payload = JSON.parse(payloadBuffer.toString('utf-8')) as SessionTokenPayload;
  } catch {
    return { valid: false, reason: 'Invalid session token payload.' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.v !== 1) {
    return { valid: false, reason: 'Unsupported session token version.' };
  }

  if (typeof payload.sid !== 'string' || !isValidSessionId(payload.sid)) {
    return { valid: false, reason: 'Invalid session token session id.' };
  }

  if (!Number.isInteger(payload.exp) || payload.exp <= nowSeconds) {
    return { valid: false, reason: 'Session token expired.' };
  }

  if (!Number.isInteger(payload.iat) || payload.iat <= 0 || payload.iat > payload.exp) {
    return { valid: false, reason: 'Invalid session token timestamps.' };
  }

  if (payload.sid !== sessionId) {
    return { valid: false, reason: 'Session token does not match session id.' };
  }

  return { valid: true };
}

function parseRootKey(rootKey: string): Buffer | undefined {
  const trimmed = rootKey.trim();
  const normalized = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (!/^[a-fA-F0-9]{64}$/.test(normalized)) {
    return undefined;
  }
  return Buffer.from(normalized, 'hex');
}

function deriveSessionSigningKey(rootKey: Buffer): Buffer {
  // Use a dedicated context so session-token signing is separated from L402 macaroon key usage.
  return createHmac('sha256', rootKey).update('fiber-pay:agent-serve:session-token:v1').digest();
}

function resolveSessionCredentials(
  body: Record<string, unknown> | undefined,
  secret: Buffer,
  ttlSeconds: number,
):
  | { ok: true; credentials: SessionCredentials }
  | { ok: false; status: number; code: string; message: string } {
  const rawSessionId = body?.sessionId;
  const rawSessionToken = body?.sessionToken;
  const hasSessionId = rawSessionId !== undefined;
  const hasSessionToken = rawSessionToken !== undefined;

  if (!hasSessionId && !hasSessionToken) {
    const sessionId = `sess-${randomUUID()}`;
    return {
      ok: true,
      credentials: {
        sessionId,
        sessionToken: mintSessionToken(sessionId, secret, ttlSeconds),
        created: true,
      },
    };
  }

  if (!hasSessionId || !hasSessionToken) {
    return {
      ok: false,
      status: 400,
      code: 'SESSION_MISSING_TOKEN',
      message: 'Both "sessionId" and "sessionToken" are required when resuming a session.',
    };
  }

  if (typeof rawSessionId !== 'string' || typeof rawSessionToken !== 'string') {
    return {
      ok: false,
      status: 400,
      code: 'SESSION_INVALID_INPUT',
      message: '"sessionId" and "sessionToken" must be strings.',
    };
  }

  const sessionId = rawSessionId.trim();
  const sessionToken = rawSessionToken.trim();

  if (!isValidSessionId(sessionId)) {
    return {
      ok: false,
      status: 400,
      code: 'SESSION_INVALID_ID',
      message: 'Invalid "sessionId" format.',
    };
  }

  const verifyResult = verifySessionToken(sessionId, sessionToken, secret);
  if (!verifyResult.valid) {
    return {
      ok: false,
      status: 403,
      code: 'SESSION_INVALID_TOKEN',
      message: verifyResult.reason,
    };
  }

  return {
    ok: true,
    credentials: {
      sessionId,
      sessionToken,
      created: false,
    },
  };
}

function getStaticRequestSessionToken(req: express.Request): string | undefined {
  const fromHeader = req.headers['x-session-token'];
  const headerToken = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  if (typeof headerToken === 'string' && headerToken.trim().length > 0) {
    return headerToken.trim();
  }

  return undefined;
}

function getStaticRequestSessionId(req: express.Request): string | undefined {
  const fromHeader = req.headers['x-session-id'];
  const headerSessionId = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  if (typeof headerSessionId === 'string' && headerSessionId.trim().length > 0) {
    return headerSessionId.trim();
  }

  return undefined;
}

function resolveWorkspaceSessionAccess(
  rawSessionId: string | string[] | undefined,
  sessionToken: string | undefined,
  secret: Buffer,
): { ok: true; sessionId: string } | { ok: false; status: number; code: string; message: string } {
  const rawSessionIdValue = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
  const sessionId = typeof rawSessionIdValue === 'string' ? rawSessionIdValue.trim() : '';

  if (sessionId.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'SESSION_MISSING_ID',
      message: 'Missing session id. Provide x-session-id header.',
    };
  }

  if (!isValidSessionId(sessionId)) {
    return {
      ok: false,
      status: 400,
      code: 'SESSION_INVALID_ID',
      message: 'Invalid "sessionId" format.',
    };
  }

  if (!sessionToken) {
    return {
      ok: false,
      status: 400,
      code: 'SESSION_MISSING_TOKEN',
      message: 'Missing session token. Provide x-session-token header.',
    };
  }

  const tokenVerifyResult = verifySessionToken(sessionId, sessionToken, secret);
  if (!tokenVerifyResult.valid) {
    return {
      ok: false,
      status: 403,
      code: 'SESSION_INVALID_TOKEN',
      message: tokenVerifyResult.reason,
    };
  }

  return { ok: true, sessionId };
}

function normalizeWorkspaceStaticPath(rawPath: string | undefined): string | undefined {
  if (rawPath?.includes('\0')) {
    return undefined;
  }

  let candidate = (rawPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (candidate.length === 0 || candidate.endsWith('/')) {
    candidate = `${candidate}index.html`;
  }

  const normalized = pathPosix.normalize(candidate);
  if (normalized.length === 0 || normalized === '.' || normalized === '..') {
    return undefined;
  }

  if (
    pathPosix.isAbsolute(normalized) ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    return undefined;
  }

  return normalized;
}

function normalizeWorkspaceDirectoryPath(rawPath: string | undefined): string | undefined {
  if (rawPath?.includes('\0')) {
    return undefined;
  }

  const candidate = (rawPath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (candidate.length === 0) {
    return '';
  }

  const normalized = pathPosix.normalize(candidate);
  if (normalized === '.' || normalized === '..') {
    return undefined;
  }

  if (
    pathPosix.isAbsolute(normalized) ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    return undefined;
  }

  return normalized;
}

function getStaticContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return STATIC_CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
}

async function readWorkspaceStaticFile(
  client: BoxliteClient,
  sessionId: string,
  relativePath: string,
  maxBytes: number,
): Promise<WorkspaceStaticReadResult> {
  const safeSessionId = sanitizeSessionId(sessionId);
  const sessionDir = `/workspace/sessions/${safeSessionId}`;
  const sessionDirQuoted = shellQuote(sessionDir).trimEnd();
  const relativePathQuoted = shellQuote(relativePath).trimEnd();

  const result = await client.exec(
    'sh',
    [
      '-c',
      [
        'set -eu',
        `SESSION_DIR=${sessionDirQuoted}`,
        `REL_PATH=${relativePathQuoted}`,
        `MAX_BYTES=${Math.floor(maxBytes)}`,
        'BASE="$(readlink -f "$SESSION_DIR" 2>/dev/null || true)"',
        'if [ -z "$BASE" ]; then echo "__ERR__:SESSION_NOT_FOUND"; exit 0; fi',
        'TARGET="$BASE/$REL_PATH"',
        'REAL_TARGET="$(readlink -f "$TARGET" 2>/dev/null || true)"',
        'if [ -z "$REAL_TARGET" ]; then echo "__ERR__:NOT_FOUND"; exit 0; fi',
        'case "$REAL_TARGET" in "$BASE"|"$BASE"/*) ;; *) echo "__ERR__:PATH_OUTSIDE_SESSION"; exit 0 ;; esac',
        'if [ -d "$REAL_TARGET" ]; then REAL_TARGET="$REAL_TARGET/index.html"; fi',
        'if [ ! -f "$REAL_TARGET" ]; then echo "__ERR__:NOT_FOUND"; exit 0; fi',
        'SIZE="$(wc -c < "$REAL_TARGET" | tr -d "[:space:]")"',
        'if [ -z "$SIZE" ]; then SIZE=0; fi',
        'if [ "$SIZE" -gt "$MAX_BYTES" ]; then echo "__ERR__:TOO_LARGE:$SIZE"; exit 0; fi',
        'MTIME="$(stat -c %Y "$REAL_TARGET" 2>/dev/null || stat -f %m "$REAL_TARGET" 2>/dev/null || echo 0)"',
        'printf "__META__:%s:%s\\n" "$SIZE" "$MTIME"',
        'base64 "$REAL_TARGET"',
      ].join(' && '),
    ],
    { timeout: 30 },
  );

  if (result.exit_code !== 0) {
    return {
      ok: false,
      code: 'EXEC_FAILED',
      message: result.stderr.trim().slice(0, 300),
    };
  }

  const lines = result.stdout.replace(/\r/g, '').split('\n');
  const firstLine = (lines.shift() || '').trim();

  if (firstLine.startsWith('__ERR__:')) {
    const detail = firstLine.slice('__ERR__:'.length);
    if (detail === 'SESSION_NOT_FOUND') {
      return { ok: false, code: 'SESSION_NOT_FOUND' };
    }
    if (detail === 'NOT_FOUND') {
      return { ok: false, code: 'NOT_FOUND' };
    }
    if (detail === 'PATH_OUTSIDE_SESSION') {
      return { ok: false, code: 'PATH_OUTSIDE_SESSION' };
    }
    if (detail.startsWith('TOO_LARGE:')) {
      const rawSize = detail.slice('TOO_LARGE:'.length);
      const sizeBytes = Number.parseInt(rawSize, 10);
      return {
        ok: false,
        code: 'TOO_LARGE',
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined,
      };
    }

    return {
      ok: false,
      code: 'EXEC_FAILED',
      message: detail,
    };
  }

  if (!firstLine.startsWith('__META__:')) {
    return {
      ok: false,
      code: 'EXEC_FAILED',
      message: 'Unexpected workspace static response format.',
    };
  }

  const [, sizePart = '0', mtimePart = '0'] = firstLine.split(':');
  const sizeBytes = Number.parseInt(sizePart, 10);
  const mtimeEpochSeconds = Number.parseInt(mtimePart, 10);
  const base64Payload = lines.join('').trim();
  const content = Buffer.from(base64Payload, 'base64');

  if (Number.isFinite(sizeBytes) && content.length !== sizeBytes) {
    return {
      ok: false,
      code: 'EXEC_FAILED',
      message: 'Workspace static file size mismatch.',
    };
  }

  return {
    ok: true,
    file: {
      content,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : content.length,
      mtimeEpochSeconds: Number.isFinite(mtimeEpochSeconds) ? mtimeEpochSeconds : 0,
    },
  };
}

async function listWorkspaceDirectory(
  client: BoxliteClient,
  sessionId: string,
  relativeDirPath: string,
  maxEntries: number,
): Promise<WorkspaceDirectoryListResult> {
  const safeSessionId = sanitizeSessionId(sessionId);
  const sessionDir = `/workspace/sessions/${safeSessionId}`;
  const sessionDirQuoted = shellQuote(sessionDir).trimEnd();
  const relativeDirQuoted = shellQuote(relativeDirPath).trimEnd();

  const result = await client.exec(
    'sh',
    [
      '-c',
      [
        'set -eu',
        `SESSION_DIR=${sessionDirQuoted}`,
        `REL_DIR=${relativeDirQuoted}`,
        `MAX_ENTRIES=${Math.floor(maxEntries)}`,
        'BASE="$(readlink -f "$SESSION_DIR" 2>/dev/null || true)"',
        'if [ -z "$BASE" ]; then echo "__ERR__:SESSION_NOT_FOUND"; exit 0; fi',
        'TARGET="$BASE"',
        'if [ -n "$REL_DIR" ]; then TARGET="$BASE/$REL_DIR"; fi',
        'REAL_DIR="$(readlink -f "$TARGET" 2>/dev/null || true)"',
        'if [ -z "$REAL_DIR" ]; then echo "__ERR__:NOT_FOUND"; exit 0; fi',
        'case "$REAL_DIR" in "$BASE"|"$BASE"/*) ;; *) echo "__ERR__:PATH_OUTSIDE_SESSION"; exit 0 ;; esac',
        'if [ ! -d "$REAL_DIR" ]; then echo "__ERR__:NOT_DIRECTORY"; exit 0; fi',
        'TRUNCATED=0',
        'COUNT=0',
        'for ENTRY in "$REAL_DIR"/* "$REAL_DIR"/.*; do',
        '  [ -e "$ENTRY" ] || continue',
        '  NAME="$(basename "$ENTRY")"',
        '  [ "$NAME" = "." ] && continue',
        '  [ "$NAME" = ".." ] && continue',
        '  if [ "$COUNT" -ge "$MAX_ENTRIES" ]; then TRUNCATED=1; break; fi',
        '  COUNT=$((COUNT + 1))',
        '  if [ -L "$ENTRY" ]; then TYPE="symlink"; SIZE=0;',
        '  elif [ -d "$ENTRY" ]; then TYPE="dir"; SIZE=0;',
        '  else TYPE="file"; SIZE="$(wc -c < "$ENTRY" | tr -d "[:space:]")"; fi',
        '  [ -z "$SIZE" ] && SIZE=0',
        '  MTIME="$(stat -c %Y "$ENTRY" 2>/dev/null || stat -f %m "$ENTRY" 2>/dev/null || echo 0)"',
        '  NAME_B64="$(printf %s "$NAME" | base64 | tr -d "\\n")"',
        '  printf "__ENTRY__:%s:%s:%s:%s\\n" "$NAME_B64" "$TYPE" "$SIZE" "$MTIME"',
        'done',
        'printf "__TRUNCATED__:%s\\n" "$TRUNCATED"',
      ].join('\n'),
    ],
    { timeout: 30 },
  );

  if (result.exit_code !== 0) {
    return {
      ok: false,
      code: 'EXEC_FAILED',
      message: result.stderr.trim().slice(0, 300),
    };
  }

  const lines = result.stdout
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line.length > 0);
  const firstLine = lines[0] || '';

  if (firstLine.startsWith('__ERR__:')) {
    const detail = firstLine.slice('__ERR__:'.length);
    if (detail === 'SESSION_NOT_FOUND') return { ok: false, code: 'SESSION_NOT_FOUND' };
    if (detail === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND' };
    if (detail === 'NOT_DIRECTORY') return { ok: false, code: 'NOT_DIRECTORY' };
    if (detail === 'PATH_OUTSIDE_SESSION') return { ok: false, code: 'PATH_OUTSIDE_SESSION' };
    return { ok: false, code: 'EXEC_FAILED', message: detail };
  }

  const entries: WorkspaceDirectoryEntry[] = [];
  let truncated = false;

  for (const line of lines) {
    if (line.startsWith('__ENTRY__:')) {
      const payload = line.slice('__ENTRY__:'.length);
      const [nameB64 = '', type = 'file', sizePart = '0', mtimePart = '0'] = payload.split(':');

      let name = '';
      try {
        name = Buffer.from(nameB64, 'base64').toString('utf-8');
      } catch {
        name = '';
      }

      if (name.length === 0) {
        continue;
      }

      const sizeBytes = Number.parseInt(sizePart, 10);
      const mtimeEpochSeconds = Number.parseInt(mtimePart, 10);
      const normalizedType: WorkspaceDirectoryEntry['type'] =
        type === 'dir' || type === 'symlink' ? type : 'file';
      const relativePath = relativeDirPath.length > 0 ? `${relativeDirPath}/${name}` : name;

      entries.push({
        name,
        path: relativePath,
        type: normalizedType,
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
        mtimeEpochSeconds: Number.isFinite(mtimeEpochSeconds) ? mtimeEpochSeconds : 0,
      });
      continue;
    }

    if (line === '__TRUNCATED__:1') {
      truncated = true;
    }
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  return {
    ok: true,
    listing: {
      path: relativeDirPath,
      entries,
      truncated,
    },
  };
}

/**
 * Check available disk space on /workspace inside the BoxLite container.
 * Returns available bytes and usage percentage, or null if the check fails.
 */
async function checkDiskSpace(
  client: BoxliteClient,
): Promise<{ availableBytes: number; usedPercent: number } | null> {
  try {
    const result = await client.exec(
      'sh',
      ['-c', "df -P /workspace | awk 'NR==2 {print $4, $5}'"],
      { timeout: 5 },
    );
    if (result.exit_code !== 0) return null;
    const [availStr, usedStr] = result.stdout.trim().split(/\s+/);
    const availableBytes = parseInt(availStr, 10) * 1024; // df outputs 1K blocks
    const usedPercent = parseInt(usedStr.replace('%', ''), 10);
    if (Number.isNaN(availableBytes) || Number.isNaN(usedPercent)) return null;
    return { availableBytes, usedPercent };
  } catch {
    return null;
  }
}

/**
 * Clean up stale session workspaces based on mtime.
 * Runs inside the BoxLite container so it has access to the actual paths.
 */
async function cleanupStaleWorkspaces(client: BoxliteClient, ttlHours: number): Promise<void> {
  try {
    await client.exec(
      'sh',
      [
        '-c',
        `find /workspace/sessions /tmp/fiber-sessions -mindepth 1 -maxdepth 1 -type d -mtime +${Math.floor(ttlHours)} -exec rm -rf {} + 2>/dev/null || true`,
      ],
      { timeout: 60 },
    );
  } catch {
    // Best-effort cleanup; do not crash the server.
  }
}

/**
 * Build the argument list for `unshare` that wraps a command with per-session
 * Linux namespace isolation:
 *
 *   - user namespace  → virtual root (no real privilege escalation)
 *   - PID namespace   → agent cannot enumerate other sessions' processes
 *   - mount namespace → /workspace and /tmp are private bind-mounts
 *   - --mount-proc    → /proc reflects only the session's PID namespace
 *
 * The session directory is created lazily inside the sh script so that the
 * first request for a session initialises its workspace automatically.
 */
function buildIsolationWrapArgs(
  command: string,
  args: string[],
  sessionDir: string,
  sessionTmpDir: string,
): string[] {
  const quotedCmd = [command, ...args].map(shellQuote).join(' ');
  // Steps executed inside the new namespaces:
  //   1. mkdir -p  — create session dirs if they do not yet exist
  //   2. mount --bind — redirect /workspace to the session-specific dir
  //   3. cd /workspace — re-anchor cwd to the bind-mounted path
  //   4. mount --bind — redirect /tmp to the session-specific tmp dir
  //   5. exec — replace sh with the actual agent command (zero overhead)
  const script = [
    // In a user namespace the shell may reset HOME to /root (via getpwuid).
    // Force it back to /home/boxlite so acpx finds sessions in the same
    // directory that "sessions ensure" used outside the namespace.
    `export HOME=${shellQuote('/home/boxlite')}`,
    `mkdir -p ${shellQuote(sessionDir)}`,
    `mkdir -p ${shellQuote(sessionTmpDir)}`,
    // Bind-mount the session-specific directory over /workspace.
    // Because `ensure` runs inside this same namespace, it will safely
    // create the `.acpx` state directly inside the session directory.
    `mount --bind ${shellQuote(sessionDir)} /workspace`,
    `cd /workspace`,
    `mount --bind ${shellQuote(sessionTmpDir)} /tmp`,
    `exec ${quotedCmd}`,
  ].join(' && ');

  return [
    '--user',
    '--pid',
    '--mount',
    '--fork',
    '--map-root-user',
    '--mount-proc',
    'sh',
    '-c',
    script,
  ];
}

async function runAcpx(
  agent: string,
  prompt: string,
  options: {
    cwd?: string;
    approveAll?: boolean;
    timeoutSeconds: number;
    boxliteUrl: string;
    boxliteBoxId: string;
    sessionId?: string;
    format?: string;
    signal?: AbortSignal;
    onChunk?: (chunk: { type: 'stdout' | 'stderr'; text: string }) => void;
    proxyEnv?: Record<string, string>;
  },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const client = new BoxliteClient(options.boxliteUrl, options.boxliteBoxId);
  const supportsGlobalFlags = !['opencode'].includes(agent);

  // Compute stable session paths.
  // Named sessions: deterministic path so successive requests share the same workspace.
  // Anonymous (no sessionId): random UUID path, cleaned up after the request.
  const safeId = options.sessionId ? sanitizeSessionId(options.sessionId) : `anon-${randomUUID()}`;
  const sessionDir = `/workspace/sessions/${safeId}`;
  const sessionTmpDir = `/tmp/fiber-sessions/${safeId}`;

  async function execPrompt(): Promise<{ stdout: string; stderr: string; exit_code: number }> {
    const acpxArgs: string[] = [];
    if (supportsGlobalFlags) {
      acpxArgs.push('--format', options.format || 'quiet');
      if (options.approveAll) acpxArgs.push('--approve-all');
      if (options.cwd) acpxArgs.push('--cwd', '/workspace');
      if (options.timeoutSeconds > 0) acpxArgs.push('--timeout', String(options.timeoutSeconds));
    }
    if (options.sessionId) {
      acpxArgs.push(agent, '-s', options.sessionId, prompt);
    } else {
      acpxArgs.push(agent, 'exec', prompt);
    }

    // Wrap acpx inside `unshare` so that the
    // agent process gets its own PID and mount namespaces.  Inside those
    // namespaces the sh init script bind-mounts the per-session directory
    // over /workspace and a per-session tmpdir over /tmp before exec-ing
    // acpx, giving each session a completely private filesystem view.
    const execCommand = 'unshare';
    const execArgs = buildIsolationWrapArgs('acpx', acpxArgs, sessionDir, sessionTmpDir);

    const execOptions = {
      env: buildSafeEnv(options.proxyEnv),
      timeout: options.timeoutSeconds,
      signal: options.signal,
    };

    if (!options.onChunk) {
      return client.exec(execCommand, execArgs, execOptions);
    }

    let stdout = '';
    let stderr = '';
    let stderrLineBuffer = '';
    let exitCode: number | undefined;

    for await (const chunk of client.execStream(execCommand, execArgs, execOptions)) {
      if (chunk.stdout.length > 0) {
        stdout += chunk.stdout;
        options.onChunk({ type: 'stdout', text: chunk.stdout });
      }

      if (chunk.stderr.length > 0) {
        stderr += chunk.stderr;
        stderrLineBuffer += chunk.stderr;

        let nextLineBreak = stderrLineBuffer.indexOf('\n');
        while (nextLineBreak !== -1) {
          const line = stderrLineBuffer.slice(0, nextLineBreak + 1);
          if (!isIgnorableAcpxStderrLine(line)) {
            options.onChunk({ type: 'stderr', text: line });
          }
          stderrLineBuffer = stderrLineBuffer.slice(nextLineBreak + 1);
          nextLineBreak = stderrLineBuffer.indexOf('\n');
        }
      }

      if (chunk.exit_code !== undefined) {
        exitCode = chunk.exit_code;
      }
    }

    if (exitCode === undefined) {
      throw new BoxliteError('EXEC_FAILED', 'BoxLite exec returned without exit code');
    }

    if (stderrLineBuffer.length > 0 && !isIgnorableAcpxStderrLine(stderrLineBuffer)) {
      options.onChunk({ type: 'stderr', text: stderrLineBuffer });
    }

    return {
      stdout,
      stderr,
      exit_code: exitCode,
    };
  }

  async function closeSession(): Promise<void> {
    if (!options.sessionId || options.sessionId.startsWith('__')) return;
    try {
      await client.exec(
        'sh',
        [
          '-c',
          `cd /workspace && acpx ${shellQuote(agent)} sessions close ${shellQuote(options.sessionId)}`,
        ],
        {
          env: buildSafeEnv(options.proxyEnv),
          timeout: 10,
        },
      );
    } catch {}
    // Clean up the isolated session workspace so that a re-opened session
    // starts with a fresh directory rather than stale state.
    client
      .exec('sh', ['-c', `rm -rf ${shellQuote(sessionDir)} ${shellQuote(sessionTmpDir)}`], {
        timeout: 10,
      })
      .catch(() => {});
  }

  async function ensureNamedSession(sessionName: string): Promise<void> {
    const execIsolated = async (acpxArgs: string[], timeoutSeconds: number) => {
      const args = buildIsolationWrapArgs('acpx', acpxArgs, sessionDir, sessionTmpDir);
      return client.exec('unshare', args, {
        env: buildSafeEnv(options.proxyEnv),
        timeout: timeoutSeconds,
      });
    };

    const ensureResult = await execIsolated(
      [agent, 'sessions', 'ensure', '--name', sessionName],
      120,
    );

    if (ensureResult.exit_code === 0) {
      return;
    }

    const createResult = await execIsolated([agent, 'sessions', 'new', '--name', sessionName], 120);
    if (createResult.exit_code !== 0) {
      const ensureErr = ensureResult.stderr.trim().slice(0, 500);
      const createErr = createResult.stderr.trim().slice(0, 500);
      throw new BoxliteError(
        'EXEC_FAILED',
        `Failed to prepare acpx session "${sessionName}" (ensure=${ensureResult.exit_code}, new=${createResult.exit_code}). ensureStderr=${ensureErr || 'n/a'} newStderr=${createErr || 'n/a'}`,
      );
    }
  }

  if (options.sessionId) {
    try {
      await ensureNamedSession(options.sessionId);
    } catch (err) {
      await closeSession();
      throw err;
    }

    let result: { stdout: string; stderr: string; exit_code: number };
    try {
      result = await execPrompt();
    } catch (err) {
      await closeSession();
      throw err;
    }

    const reconnectHint = RECONNECT_PATTERN.test(result.stderr);
    const reconnectWithoutOutput =
      reconnectHint &&
      result.exit_code === 0 &&
      result.stdout.trim().length === 0 &&
      hasOnlyIgnorableAcpxStderr(result.stderr);

    // First try a non-destructive retry when acpx reports reconnect-needed
    // but produced no output. This often resolves first-attach jitter without
    // tearing down session state.
    if (reconnectWithoutOutput) {
      try {
        result = await execPrompt();
      } catch (err) {
        await closeSession();
        throw err;
      }
    }

    const postRetryReconnectHint = RECONNECT_PATTERN.test(result.stderr);
    const postRetryReconnectWithoutOutput =
      postRetryReconnectHint &&
      result.exit_code === 0 &&
      result.stdout.trim().length === 0 &&
      hasOnlyIgnorableAcpxStderr(result.stderr);
    const shouldReconnectRetry =
      !options.sessionId.startsWith('__') &&
      (result.exit_code !== 0 || postRetryReconnectWithoutOutput);

    if (shouldReconnectRetry) {
      await closeSession();
      try {
        await ensureNamedSession(options.sessionId);
      } catch (ensureErr) {
        await closeSession();
        throw ensureErr;
      }
      try {
        result = await execPrompt();
      } catch (err) {
        await closeSession();
        throw err;
      }
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exit_code,
    };
  }

  // Anonymous one-shot request: clean up the workspace after exec completes.
  const result = await execPrompt();
  client
    .exec('sh', ['-c', `rm -rf ${shellQuote(sessionDir)} ${shellQuote(sessionTmpDir)}`], {
      timeout: 10,
    })
    .catch(() => {});
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exit_code,
  };
}

export async function runAgentServeCommand(
  config: CliConfig,
  options: AgentServeOptions,
): Promise<void> {
  const asJson = Boolean(options.json);
  const port = parseInt(options.port, 10);
  const host = options.host;
  const priceCkb = parseFloat(options.price);
  const expirySeconds = parseInt(options.expiry, 10);
  const timeoutSeconds = parseInt(options.timeout, 10);
  const boxliteUrl = options.boxliteUrl || process.env.BOXLITE_URL || 'http://localhost:8100';
  const boxliteBoxId = options.boxliteBoxId || process.env.BOXLITE_BOX_ID || 'fiber-pay-agent';

  const rootKey = options.rootKey || process.env.L402_ROOT_KEY;

  const parsePositiveIntegerOption = (
    value: string | undefined,
    defaultValue: string,
    optionName: string,
    errorCode: string,
  ): number => {
    const rawValue = (value ?? defaultValue).trim();
    if (!/^[1-9]\d*$/.test(rawValue)) {
      const message = `Invalid value for ${optionName}: expected a positive integer, received "${value ?? defaultValue}".`;
      if (asJson) {
        printJsonError({
          code: errorCode,
          message,
          recoverable: true,
          suggestion: `Provide ${optionName} as a positive integer value.`,
        });
      } else {
        console.error(`Error: ${message}`);
        console.error(`  Provide ${optionName} as a positive integer value.`);
      }
      process.exit(1);
    }

    return Number(rawValue);
  };

  if (Number.isNaN(port) || port < 0 || port > 65535) {
    if (asJson) {
      printJsonError({
        code: 'AGENT_SERVE_INVALID_PORT',
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
        code: 'AGENT_SERVE_INVALID_PRICE',
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
        code: 'AGENT_SERVE_MISSING_ROOT_KEY',
        message: 'L402 root key is required.',
        recoverable: true,
        suggestion:
          'Provide --root-key <64-hex-chars> or set L402_ROOT_KEY env var. Generate with: openssl rand -hex 32',
      });
    } else {
      console.error('Error: L402 root key is required.');
      console.error('  Provide --root-key <64-hex-chars> or set L402_ROOT_KEY env var.');
      console.error('  Generate one with: openssl rand -hex 32');
    }
    process.exit(1);
  }

  const sessionSecret = parseRootKey(rootKey);
  if (!sessionSecret) {
    if (asJson) {
      printJsonError({
        code: 'AGENT_SERVE_INVALID_ROOT_KEY',
        message: 'Invalid root key format.',
        recoverable: true,
        suggestion: 'Provide a 32-byte hex key with --root-key (example: openssl rand -hex 32).',
      });
    } else {
      console.error('Error: Invalid root key format.');
      console.error('  Provide a 32-byte hex key with --root-key (example: openssl rand -hex 32).');
    }
    process.exit(1);
  }
  const sessionSigningSecret = deriveSessionSigningKey(sessionSecret);

  const workspaceMinFreeMb = parsePositiveIntegerOption(
    options.workspaceMinFreeMb,
    '100',
    '--workspace-min-free-mb',
    'AGENT_SERVE_INVALID_WORKSPACE_MIN_FREE_MB',
  );
  const workspaceTtlOption = options.workspaceTtl ?? options.workspaceTtlHours;
  const workspaceTtlHours = parsePositiveIntegerOption(
    workspaceTtlOption,
    '24',
    '--workspace-ttl',
    'AGENT_SERVE_INVALID_WORKSPACE_TTL',
  );

  const proxyEnabled = options.proxy !== false;
  if (!proxyEnabled) {
    const allowInsecureNoProxy = process.env.FIBER_PAY_ALLOW_INSECURE_NO_PROXY === '1';
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
    const hostIsLoopback = loopbackHosts.has(host);

    if (!allowInsecureNoProxy || !hostIsLoopback) {
      const message =
        'Refusing to start with --no-proxy. This mode bypasses proxy key-shim and network deny-list protections.';
      const suggestion =
        'For local debugging only, set FIBER_PAY_ALLOW_INSECURE_NO_PROXY=1 and bind --host to loopback (127.0.0.1, localhost, or ::1).';

      if (asJson) {
        printJsonError({
          code: 'AGENT_SERVE_INSECURE_NO_PROXY_BLOCKED',
          message,
          recoverable: true,
          suggestion,
        });
      } else {
        console.error(`Error: ${message}`);
        console.error(`  ${suggestion}`);
      }
      process.exit(1);
    }

    if (!asJson) {
      console.warn(
        'Warning: --no-proxy is enabled for local debugging. Real API keys are passed into the container and outbound network filtering is disabled.',
      );
    }
  }

  // Pre-flight: check BoxLite connectivity and acpx availability
  const client = new BoxliteClient(boxliteUrl, boxliteBoxId);
  try {
    const boxExists = await client.checkBoxExists();
    if (!boxExists) {
      const message = `BoxLite box "${boxliteBoxId}" was not found.`;
      if (asJson) {
        printJsonError({
          code: 'AGENT_SERVE_BOXLITE_BOX_NOT_FOUND',
          message,
          recoverable: true,
          suggestion: 'Create the box in BoxLite or check the --boxlite-box-id value.',
        });
      } else {
        console.error(`Error: ${message}`);
        console.error('  Create the box in BoxLite or check the --boxlite-box-id value.');
      }
      process.exit(1);
    }
    await client.exec('acpx', ['--version'], { timeout: 10 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const displayMessage = `BoxLite is unreachable or misconfigured: ${message}`;
    if (asJson) {
      printJsonError({
        code: 'AGENT_SERVE_BOXLITE_ERROR',
        message: displayMessage,
        recoverable: true,
        suggestion: 'Ensure BoxLite is running and the box exists.',
      });
    } else {
      console.error(`Error: ${displayMessage}`);
      console.error('  Ensure BoxLite is running and the box exists.');
    }
    process.exit(1);
  }

  // Isolation is mandatory: prepare directory structure and verify that
  // unprivileged user namespaces work before serving traffic.
  const sessionTokenTtlSeconds = Math.max(MIN_SESSION_TOKEN_TTL_SECONDS, workspaceTtlHours * 3600);
  // Ensure the base session directories exist (non-fatal; the isolation
  // script also creates them lazily, but pre-creating avoids a race on
  // the very first request).
  try {
    await client.exec('sh', ['-c', 'mkdir -p /workspace/sessions /tmp/fiber-sessions'], {
      timeout: 5,
    });
  } catch {
    // Non-fatal: the namespace init script will retry inside unshare.
  }

  // Probe whether the kernel allows unprivileged user namespaces.
  try {
    await client.exec(
      'unshare',
      [
        '--user',
        '--pid',
        '--mount',
        '--fork',
        '--map-root-user',
        '--mount-proc',
        'sh',
        '-c',
        'echo isolation-probe-ok',
      ],
      { timeout: 10 },
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const message = `Linux namespace isolation probe failed: ${errorMsg}. This deployment requires unshare-based isolation.`;
    if (asJson) {
      printJsonError({
        code: 'AGENT_SERVE_ISOLATION_REQUIRED',
        message,
        recoverable: true,
        suggestion:
          'Run scripts/boxlite-setup.sh in the Box and ensure kernel.unprivileged_userns_clone=1 on the host.',
      });
    } else {
      console.error(`Error: ${message}`);
      console.error(
        '  Run scripts/boxlite-setup.sh in the Box and ensure kernel.unprivileged_userns_clone=1 on the host.',
      );
    }
    process.exit(1);
  }

  // Disk-space guard: probe /workspace availability at startup.
  const disk = await checkDiskSpace(client);
  if (disk) {
    const availableMb = Math.floor(disk.availableBytes / (1024 * 1024));
    if (disk.usedPercent >= 95) {
      const message = `Workspace disk is critically full (${disk.usedPercent}% used, ${availableMb} MB free).`;
      if (asJson) {
        printJsonError({
          code: 'AGENT_SERVE_DISK_FULL',
          message,
          recoverable: true,
          suggestion: 'Free up disk space on the BoxLite host or increase container storage.',
        });
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(1);
    }
    if (disk.usedPercent >= 90) {
      console.warn(
        `Warning: Workspace disk is nearly full (${disk.usedPercent}% used, ${availableMb} MB free).`,
      );
    }
    if (availableMb < workspaceMinFreeMb) {
      console.warn(
        `Warning: Workspace free space (${availableMb} MB) is below --workspace-min-free-mb (${workspaceMinFreeMb} MB). New sessions may be rejected.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Host-side proxy: API-key shim + network deny-list
  // ---------------------------------------------------------------------------
  let agentProxy: AgentProxy | undefined;
  let proxyEnv: Record<string, string> | undefined;

  if (proxyEnabled) {
    const rawProxyPort = options.proxyPort || '8111';
    const proxyPort = Number.parseInt(rawProxyPort, 10);
    if (!Number.isInteger(proxyPort) || proxyPort < 0 || proxyPort > 65535) {
      const message = `Invalid --proxy-port value "${rawProxyPort}". Expected an integer between 1 and 65535.`;
      if (asJson) {
        printJsonError({
          code: 'AGENT_SERVE_INVALID_PROXY_PORT',
          message,
          recoverable: true,
          suggestion: 'Provide a valid TCP port with --proxy-port, for example --proxy-port 8111.',
        });
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(1);
    }
    const apiKeys: { anthropic?: string; openai?: string; kimi?: string } = {};
    if (process.env.ANTHROPIC_API_KEY) apiKeys.anthropic = process.env.ANTHROPIC_API_KEY;
    if (process.env.OPENAI_API_KEY) apiKeys.openai = process.env.OPENAI_API_KEY;
    if (process.env.KIMI_API_KEY) {
      apiKeys.kimi = process.env.KIMI_API_KEY;
    } else if (process.env.OPENCODE_API_KEY) {
      // Common local setup keeps Kimi credentials under OPENCODE_API_KEY.
      apiKeys.kimi = process.env.OPENCODE_API_KEY;
    }

    const hasProxyApiKeys = Boolean(apiKeys.anthropic || apiKeys.openai || apiKeys.kimi);

    agentProxy = new AgentProxy({
      port: proxyPort,
      host: '0.0.0.0',
      hostAddr: options.proxyHostAddr,
      apiKeys,
    });

    try {
      await agentProxy.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const displayMessage = `Failed to start host-side proxy: ${message}`;
      if (asJson) {
        printJsonError({
          code: 'AGENT_SERVE_PROXY_ERROR',
          message: displayMessage,
          recoverable: true,
          suggestion: `Check if port ${proxyPort} is available, or use --proxy-port to choose a different port.`,
        });
      } else {
        console.error(`Error: ${displayMessage}`);
      }
      process.exit(1);
    }

    proxyEnv = agentProxy.buildContainerEnv();

    // Write OpenCode config file into the container only when at least one
    // provider key is available for proxy-side auth injection.
    if (hasProxyApiKeys) {
      // OpenCode reads BASE_URL from a config file, not from env vars.
      try {
        const opencodeConfig = agentProxy.buildOpenCodeConfig();
        await client.exec(
          'sh',
          [
            '-c',
            `mkdir -p /home/boxlite/.config/opencode && cat > /home/boxlite/.config/opencode/opencode.json << 'PROXYEOF'
${opencodeConfig}
PROXYEOF`,
          ],
          { timeout: 5 },
        );
      } catch {
        // Non-fatal: OpenCode config is best-effort.
        if (!asJson) {
          console.warn('Warning: Failed to write OpenCode proxy config into the container.');
        }
      }
    } else if (!asJson) {
      console.warn(
        'Warning: No provider API keys found for proxy injection; preserving existing OpenCode config in the Box.',
      );
    }
  }

  // Kill stale agent processes inside the container from previous runs.
  // Zombie opencode/acpx/npm processes can hold port 4096 or npm locks,
  // preventing the daemon from starting and causing all requests to hang.
  try {
    await client.exec(
      'sh',
      [
        '-c',
        "kill -9 $(ps aux | grep -E 'opencode|acpx|npm.exec' | grep -v grep | awk '{print $1}') 2>/dev/null; rm -f /tmp/.npm/_locks/* 2>/dev/null; true",
      ],
      { timeout: 10 },
    );
  } catch {
    // Best-effort cleanup; ignore failures.
  }

  // Pre-install the provider SDK that opencode.json references (npm: @ai-sdk/anthropic).
  // Without this, the opencode daemon tries to npm-install it on first start,
  // which hangs or takes minutes through the proxy, causing all requests to time out.
  if (proxyEnabled) {
    try {
      if (!asJson) {
        console.log('Pre-installing opencode provider dependencies...');
      }
      await client.exec(
        'sh',
        [
          '-c',
          'rm -rf /root/.npm/_locks /tmp/.npm/_locks 2>/dev/null; cd /home/boxlite/.config/opencode && npm cache clean --force 2>/dev/null; npm install --prefer-offline --no-audit --no-fund @ai-sdk/anthropic 2>&1 || true',
        ],
        {
          // Do NOT pass proxyEnv here — npm needs direct internet access to
          // reach registry.npmjs.org.  The proxy is only for API key shimming.
          env: {
            HOME: '/home/boxlite',
            PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
            npm_config_yes: 'true',
          },
          timeout: 60,
        },
      );
    } catch {
      if (!asJson) {
        console.warn('Warning: Failed to pre-install opencode provider SDK.');
      }
    }

    // Warm npx cache for opencode-ai so acpx session bootstrap does not
    // attempt a network fetch during paid requests.
    try {
      if (!asJson) {
        console.log('Pre-warming opencode npx adapter cache...');
      }
      await client.exec(
        'sh',
        [
          '-c',
          'HOME=/home/boxlite npm_config_yes=true npx --yes opencode-ai --version >/dev/null 2>&1 || true',
        ],
        {
          // Keep this direct (no proxy) so npm can always reach the registry.
          env: {
            HOME: '/home/boxlite',
            PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
            npm_config_yes: 'true',
            NO_PROXY: 'registry.npmjs.org',
          },
          timeout: 60,
        },
      );
    } catch {
      if (!asJson) {
        console.warn('Warning: Failed to pre-warm opencode npx adapter cache.');
      }
    }

    // Pre-warm the opencode daemon so it is ready when the first request arrives.
    // The daemon needs ~5-10s to initialize; without pre-warming, the first
    // request pays a cold-start penalty that compounds with session setup.
    try {
      if (!asJson) {
        console.log('Pre-warming opencode daemon...');
      }
      await client.exec(
        'sh',
        [
          '-c',
          'cd /workspace && HOME=/home/boxlite /usr/local/bin/opencode acp &\n' +
            'for i in $(seq 1 15); do\n' +
            '  if nc -z 127.0.0.1 4096 2>/dev/null; then echo "daemon ready"; exit 0; fi\n' +
            '  sleep 2\n' +
            'done\n' +
            'echo "daemon not ready after 30s"',
        ],
        {
          env: buildSafeEnv(proxyEnv),
          timeout: 40,
        },
      );
    } catch {
      if (!asJson) {
        console.warn('Warning: opencode daemon pre-warming did not complete in time.');
      }
    }
  }

  const rpcClient = new FiberRpcClient({
    url: config.rpcUrl,
    biscuitToken: config.rpcBiscuitToken,
  });

  const currency: Currency = config.network === 'mainnet' ? 'Fibb' : 'Fibt';

  const app = express();
  app.use(cors());
  app.use(express.json());

  let requestCounter = 0;

  // Request visibility middleware (works for both challenge and paid flows).
  app.use((req: AgentServeRequest, res, next) => {
    const requestId = ++requestCounter;
    req._fiberPayRequestId = requestId;
    const startTime = Date.now();
    const clientIp = getClientIp(req);

    if (!asJson) {
      console.log(
        `[REQ ${requestId}] ${req.method} ${req.path} from ${clientIp} (auth=${req.headers.authorization ? 'present' : 'none'})`,
      );
    }

    res.on('finish', () => {
      if (asJson) {
        return;
      }

      const durationMs = Date.now() - startTime;
      const l402State = summarizeL402Status(req);

      if (res.statusCode === 402 || res.statusCode === 401) {
        console.log(
          `[REQ ${requestId}] challenge-issued status=${res.statusCode} duration=${durationMs}ms`,
        );
        return;
      }

      console.log(
        `[REQ ${requestId}] completed status=${res.statusCode} duration=${durationMs}ms l402=${l402State}`,
      );
    });

    next();
  });

  // L402 payment gate on all routes
  const serveWorkspaceDirectoryList = async (req: AgentServeRequest, res: express.Response) => {
    const requestId = getRequestId(req);
    const sessionId = getStaticRequestSessionId(req);
    const sessionToken = getStaticRequestSessionToken(req);
    const sessionAccess = resolveWorkspaceSessionAccess(
      sessionId,
      sessionToken,
      sessionSigningSecret,
    );

    if (!sessionAccess.ok) {
      res.status(sessionAccess.status).json({
        error: sessionAccess.message,
        code: sessionAccess.code,
      });
      return;
    }

    const rawPathParam = req.query.path;
    const rawPath = Array.isArray(rawPathParam) ? rawPathParam[0] : rawPathParam;
    const relativeDirPath = normalizeWorkspaceDirectoryPath(
      typeof rawPath === 'string' ? rawPath : undefined,
    );

    if (relativeDirPath === undefined) {
      res.status(400).json({
        error: 'Invalid workspace directory path.',
        code: 'WORKSPACE_LIST_INVALID_PATH',
      });
      return;
    }

    try {
      const listingResult = await listWorkspaceDirectory(
        client,
        sessionAccess.sessionId,
        relativeDirPath,
        MAX_DIRECTORY_LIST_ENTRIES,
      );

      if (!listingResult.ok) {
        if (!asJson) {
          console.log(
            `[REQ ${requestId}] workspace list failed session=${sessionAccess.sessionId} path=${relativeDirPath} code=${listingResult.code}`,
          );
        }

        if (listingResult.code === 'SESSION_NOT_FOUND' || listingResult.code === 'NOT_FOUND') {
          res.status(404).json({
            error: 'Workspace directory not found.',
            code: 'WORKSPACE_LIST_NOT_FOUND',
          });
          return;
        }

        if (listingResult.code === 'NOT_DIRECTORY') {
          res.status(400).json({
            error: 'Requested path is not a directory.',
            code: 'WORKSPACE_LIST_NOT_DIRECTORY',
          });
          return;
        }

        if (listingResult.code === 'PATH_OUTSIDE_SESSION') {
          res.status(403).json({
            error: 'Path escapes session workspace.',
            code: 'WORKSPACE_LIST_FORBIDDEN',
          });
          return;
        }

        res.status(502).json({
          error: 'Failed to list workspace directory from BoxLite.',
          code: 'WORKSPACE_LIST_FAILED',
          details: listingResult.message,
        });
        return;
      }

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.json({
        sessionId: sessionAccess.sessionId,
        path: listingResult.listing.path,
        entries: listingResult.listing.entries,
        truncated: listingResult.listing.truncated,
        limit: MAX_DIRECTORY_LIST_ENTRIES,
      });
    } catch (error) {
      if (!asJson) {
        console.log(
          `[REQ ${requestId}] workspace list error session=${sessionAccess.sessionId} path=${relativeDirPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      res.status(502).json({
        error: 'Failed to list workspace directory from BoxLite.',
        code: 'WORKSPACE_LIST_FAILED',
      });
    }
  };

  const serveWorkspaceStatic = async (req: AgentServeRequest, res: express.Response) => {
    const requestId = getRequestId(req);
    const sessionId = getStaticRequestSessionId(req);
    const sessionToken = getStaticRequestSessionToken(req);
    const sessionAccess = resolveWorkspaceSessionAccess(
      sessionId,
      sessionToken,
      sessionSigningSecret,
    );

    if (!sessionAccess.ok) {
      res.status(sessionAccess.status).json({
        error: sessionAccess.message,
        code: sessionAccess.code,
      });
      return;
    }

    const wildcardParam = req.params.filePath;
    const wildcardPath = Array.isArray(wildcardParam)
      ? wildcardParam.join('/')
      : typeof wildcardParam === 'string'
        ? wildcardParam
        : '';
    const relativePath = normalizeWorkspaceStaticPath(wildcardPath);
    if (!relativePath) {
      res.status(400).json({
        error: 'Invalid static file path.',
        code: 'WORKSPACE_STATIC_INVALID_PATH',
      });
      return;
    }

    try {
      const fileReadResult = await readWorkspaceStaticFile(
        client,
        sessionAccess.sessionId,
        relativePath,
        MAX_STATIC_FILE_BYTES,
      );

      if (!fileReadResult.ok) {
        if (!asJson) {
          console.log(
            `[REQ ${requestId}] workspace static read failed session=${sessionAccess.sessionId} path=${relativePath} code=${fileReadResult.code}`,
          );
        }

        if (fileReadResult.code === 'NOT_FOUND' || fileReadResult.code === 'SESSION_NOT_FOUND') {
          res
            .status(404)
            .json({ error: 'Workspace file not found.', code: 'WORKSPACE_STATIC_NOT_FOUND' });
          return;
        }

        if (fileReadResult.code === 'PATH_OUTSIDE_SESSION') {
          res
            .status(403)
            .json({ error: 'Path escapes session workspace.', code: 'WORKSPACE_STATIC_FORBIDDEN' });
          return;
        }

        if (fileReadResult.code === 'TOO_LARGE') {
          res.status(413).json({
            error: `Workspace file exceeds max size ${MAX_STATIC_FILE_BYTES} bytes.`,
            code: 'WORKSPACE_STATIC_TOO_LARGE',
            sizeBytes: fileReadResult.sizeBytes,
            maxBytes: MAX_STATIC_FILE_BYTES,
          });
          return;
        }

        res.status(502).json({
          error: 'Failed to read workspace file from BoxLite.',
          code: 'WORKSPACE_STATIC_READ_FAILED',
          details: fileReadResult.message,
        });
        return;
      }

      const { file } = fileReadResult;
      res.setHeader('Content-Type', getStaticContentType(relativePath));
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Length', String(file.sizeBytes));
      if (file.mtimeEpochSeconds > 0) {
        res.setHeader('Last-Modified', new Date(file.mtimeEpochSeconds * 1000).toUTCString());
      }
      res.status(200).send(file.content);
    } catch (error) {
      if (!asJson) {
        console.log(
          `[REQ ${requestId}] workspace static read error session=${sessionAccess.sessionId} path=${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      res.status(502).json({
        error: 'Failed to read workspace file from BoxLite.',
        code: 'WORKSPACE_STATIC_READ_FAILED',
      });
    }
  };

  app.get('/workspace/static/list', serveWorkspaceDirectoryList);
  app.get('/workspace/static', serveWorkspaceStatic);
  app.get('/workspace/static/*filePath', serveWorkspaceStatic);

  // L402 payment gate on all paid routes
  app.use(
    createL402Middleware({
      rootKey,
      priceCkb,
      expirySeconds,
      rpcClient,
      currency,
    }),
  );

  // Scheduled workspace cleanup with adaptive TTL.
  let cleanupIntervalMs = 60 * 60 * 1000; // 1 hour
  const cleanupTimer = setInterval(async () => {
    const d = await checkDiskSpace(client);
    const pressure = d
      ? d.usedPercent >= 90 || d.availableBytes < workspaceMinFreeMb * 1024 * 1024
      : false;
    const ttl = pressure ? Math.min(1, workspaceTtlHours) : workspaceTtlHours;
    if (pressure && cleanupIntervalMs > 10 * 60 * 1000) {
      cleanupIntervalMs = 10 * 60 * 1000; // speed up to 10 min under pressure
      clearInterval(cleanupTimer);
      // restart with shorter interval (handled by outer scope, just clear here)
    }
    await cleanupStaleWorkspaces(client, ttl);
  }, cleanupIntervalMs);

  // Agent endpoint
  app.post('/', async (req: AgentServeRequest, res) => {
    const requestId = getRequestId(req);
    const prompt = req.body?.prompt;
    const requestFormat = typeof req.body?.format === 'string' ? req.body.format : options.format;
    if (!prompt || typeof prompt !== 'string') {
      if (!asJson) {
        console.log(`[REQ ${requestId}] invalid request body: missing string prompt`);
      }
      res.status(400).json({
        error: 'Missing or invalid "prompt" field in request body.',
      });
      return;
    }

    const sessionResolution = resolveSessionCredentials(
      req.body as Record<string, unknown> | undefined,
      sessionSigningSecret,
      sessionTokenTtlSeconds,
    );

    if (!sessionResolution.ok) {
      if (!asJson) {
        console.log(
          `[REQ ${requestId}] rejected session credentials code=${sessionResolution.code} status=${sessionResolution.status}`,
        );
      }
      res.status(sessionResolution.status).json({
        error: sessionResolution.message,
        code: sessionResolution.code,
      });
      return;
    }

    const session = sessionResolution.credentials;
    const responseSession = {
      id: session.sessionId,
      token: session.sessionToken,
      created: session.created,
    };

    const startTime = Date.now();
    const useSse = shouldUseSse(req);

    try {
      if (!asJson) {
        console.log(
          `[REQ ${requestId}] payment accepted, invoking agent=${options.agent} promptChars=${prompt.length} session=${session.sessionId}${requestFormat && requestFormat !== 'quiet' ? ` format=${requestFormat}` : ''}${useSse ? ' stream=sse' : ''}`,
        );
      }

      if (useSse) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        let streamClosed = false;
        let clientClosed = false;
        const abortController = new AbortController();

        const heartbeat = setInterval(() => {
          if (!streamClosed && !res.writableEnded) {
            res.write(': keep-alive\n\n');
          }
        }, 15000);

        const closeStream = () => {
          if (streamClosed) {
            return;
          }
          streamClosed = true;
          clearInterval(heartbeat);
          if (!res.writableEnded) {
            res.end();
          }
        };

        const sendSse = (event: string, data: unknown) => {
          if (streamClosed || res.writableEnded) {
            return;
          }
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        const handleDisconnect = () => {
          if (streamClosed) {
            return;
          }
          clientClosed = true;
          abortController.abort();
        };

        req.on('aborted', handleDisconnect);
        res.on('close', handleDisconnect);

        const result = await runAcpx(options.agent, prompt, {
          cwd: options.cwd,
          approveAll: options.approveAll,
          timeoutSeconds,
          boxliteUrl,
          boxliteBoxId,
          sessionId: session.sessionId,
          format: requestFormat,
          signal: abortController.signal,
          onChunk: (chunk) => {
            sendSse('chunk', chunk);
          },
          proxyEnv,
        });

        if (clientClosed) {
          closeStream();
          return;
        }

        const durationMs = Date.now() - startTime;

        if (result.exitCode !== 0) {
          if (!asJson) {
            console.log(
              `[REQ ${requestId}] agent failed exit=${result.exitCode} duration=${durationMs}ms`,
            );
          }

          sendSse('error', {
            code: 'EXEC_FAILED',
            message: result.stderr.slice(0, 1000) || 'Agent execution failed.',
            agent: options.agent,
            durationMs,
            session: responseSession,
          });
          closeStream();
          return;
        }

        if (!asJson) {
          console.log(`[REQ ${requestId}] agent completed duration=${durationMs}ms`);
        }

        sendSse('done', {
          durationMs,
          agent: options.agent,
          session: responseSession,
          ...(requestFormat && requestFormat !== 'quiet' ? { format: requestFormat } : {}),
        });
        closeStream();
        return;
      }

      const result = await runAcpx(options.agent, prompt, {
        cwd: options.cwd,
        approveAll: options.approveAll,
        timeoutSeconds,
        boxliteUrl,
        boxliteBoxId,
        sessionId: session.sessionId,
        format: requestFormat,
        proxyEnv,
      });

      const durationMs = Date.now() - startTime;

      if (result.exitCode !== 0) {
        if (!asJson) {
          console.log(
            `[REQ ${requestId}] agent failed exit=${result.exitCode} duration=${durationMs}ms`,
          );
        }

        res.status(502).json({
          error: 'Agent execution failed.',
          agent: options.agent,
          stderr: result.stderr.slice(0, 1000),
          durationMs,
          session: responseSession,
        });
        return;
      }

      if (!asJson) {
        console.log(`[REQ ${requestId}] agent completed duration=${durationMs}ms`);
      }

      const data = requestFormat === 'json' ? parseJsonLines(result.stdout) : undefined;

      res.json({
        response: result.stdout.trim(),
        agent: options.agent,
        durationMs,
        session: responseSession,
        ...(requestFormat && requestFormat !== 'quiet' ? { format: requestFormat } : {}),
        ...(data !== undefined ? { data } : {}),
      });
    } catch (error) {
      if (!asJson) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[REQ ${requestId}] agent execution error: ${message}`);
      }

      if (!session.sessionId.startsWith('__')) {
        try {
          const cleanupClient = new BoxliteClient(boxliteUrl, boxliteBoxId);
          await cleanupClient.exec(
            'sh',
            [
              '-c',
              `cd /workspace && acpx ${shellQuote(options.agent)} sessions close ${shellQuote(session.sessionId)}`,
            ],
            {
              env: buildSafeEnv(proxyEnv),
              timeout: 10,
            },
          );
        } catch {}
      }

      if (useSse) {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders();
        }

        if (!res.writableEnded) {
          if (error instanceof BoxliteError) {
            res.write('event: error\n');
            res.write(
              `data: ${JSON.stringify({
                code: error.code,
                message: error.message.slice(0, 1000),
                agent: options.agent,
                durationMs: Date.now() - startTime,
                session: responseSession,
              })}\n\n`,
            );
          } else {
            res.write('event: error\n');
            res.write(
              `data: ${JSON.stringify({
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : String(error),
                agent: options.agent,
                durationMs: Date.now() - startTime,
                session: responseSession,
              })}\n\n`,
            );
          }

          res.end();
        }
        return;
      }

      if (error instanceof BoxliteError) {
        res.status(502).json({
          error: 'Agent execution failed.',
          agent: options.agent,
          stderr: error.message.slice(0, 1000),
          durationMs: Date.now() - startTime,
          session: responseSession,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error.',
        message: error instanceof Error ? error.message : String(error),
        session: responseSession,
      });
    }
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agent: options.agent });
  });

  const server: Server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        if (asJson) {
          printJsonError({
            code: 'AGENT_SERVE_PORT_IN_USE',
            message: `Port ${port} is already in use.`,
            recoverable: true,
            suggestion: 'Use a different port with --port <port>.',
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
      agent: options.agent,
      priceCkb,
      expirySeconds,
      currency,
      fiberRpcUrl: config.rpcUrl,
      boxliteUrl,
      boxliteBoxId,
      proxy: agentProxy ? { url: agentProxy.proxyUrl, port: agentProxy.listeningPort } : undefined,
    });
  } else {
    const isolationLabel = 'namespace (PID + mount + user)';
    console.log('Agent service started');
    console.log(`  Listen:     ${listenUrl}`);
    console.log(`  Agent:      ${options.agent}`);
    console.log(`  Price:      ${priceCkb} CKB per request`);
    console.log(`  Expiry:     ${expirySeconds}s`);
    console.log(`  Timeout:    ${timeoutSeconds}s per agent call`);
    console.log(`  Currency:   ${currency}`);
    console.log(`  Fiber RPC:  ${config.rpcUrl}`);
    console.log(`  BoxLite:    ${boxliteUrl} (box: ${boxliteBoxId})`);
    console.log(`  Isolation:  ${isolationLabel}`);
    if (agentProxy) {
      console.log(`  Proxy:      ${agentProxy.proxyUrl} (API key shim + network deny-list)`);
    } else {
      console.log('  Proxy:      disabled (--no-proxy)');
    }
    console.log('');
    console.log('Endpoint:');
    console.log(`  POST ${listenUrl}/  {"prompt": "your question"}`);
    console.log('');
    console.log('Press Ctrl+C to stop.');
  }

  // Graceful shutdown
  const shutdown = () => {
    clearInterval(cleanupTimer);
    if (!asJson) {
      console.log('\nStopping agent service...');
    }
    server.close(async () => {
      if (agentProxy) {
        await agentProxy.stop();
      }
      if (asJson) {
        printJsonSuccess({ status: 'stopped' });
      } else {
        console.log('Agent service stopped.');
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}
