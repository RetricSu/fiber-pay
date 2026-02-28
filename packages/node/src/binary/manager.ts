/**
 * Binary Manager
 * Handles downloading, installing, and managing the Fiber Network Node (fnn) binary
 */

import { exec } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_FIBER_VERSION } from '../constants.js';

const execAsync = promisify(exec);

// =============================================================================
// Types
// =============================================================================

export type Platform = 'darwin' | 'linux' | 'win32';
export type Arch = 'x64' | 'arm64';

export interface BinaryInfo {
  /** Path to the binary */
  path: string;
  /** Version of the binary */
  version: string;
  /** Whether the binary exists and is executable */
  ready: boolean;
}

export interface DownloadOptions {
  /** Target directory for the binary */
  installDir?: string;
  /** Specific version to download (default: latest) */
  version?: string;
  /** Force re-download even if binary exists */
  force?: boolean;
  /** Progress callback */
  onProgress?: (progress: DownloadProgress) => void;
}

export interface DownloadProgress {
  phase: 'fetching' | 'downloading' | 'extracting' | 'installing';
  percent?: number;
  message: string;
}

interface AssetCandidate {
  name: string;
  url: string;
  usesRosetta: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const GITHUB_REPO = 'nervosnetwork/fiber';
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
const DEFAULT_INSTALL_DIR = join(process.env.HOME || '~', '.fiber-pay', 'bin');
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// Binary naming patterns for different platforms
// Pattern used to match assets: fnn_vX.X.X-{pattern}.tar.gz
const BINARY_PATTERNS: Record<Platform, Record<Arch, string>> = {
  darwin: {
    x64: 'x86_64-darwin',
    arm64: 'aarch64-darwin', // May not exist yet, will fallback to x64
  },
  linux: {
    x64: 'x86_64-linux',
    arm64: 'aarch64-linux',
  },
  win32: {
    x64: 'x86_64-windows',
    arm64: 'aarch64-windows',
  },
};

// =============================================================================
// Binary Manager
// =============================================================================

export class BinaryManager {
  private installDir: string;

  constructor(installDir?: string) {
    this.installDir = installDir || DEFAULT_INSTALL_DIR;
  }

  /**
   * Get the current platform and architecture
   */
  getPlatformInfo(): { platform: Platform; arch: Arch } {
    const platform = process.platform as Platform;
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

    if (!['darwin', 'linux', 'win32'].includes(platform)) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    return { platform, arch };
  }

  /**
   * Get the pattern to match for the current platform
   */
  getAssetPattern(): string {
    const { platform, arch } = this.getPlatformInfo();
    const pattern = BINARY_PATTERNS[platform]?.[arch];

    if (!pattern) {
      throw new Error(`No binary pattern for ${platform}/${arch}`);
    }

    return pattern;
  }

  /**
   * Get the path where the binary should be installed
   */
  getBinaryPath(): string {
    const { platform } = this.getPlatformInfo();
    const binaryName = platform === 'win32' ? 'fnn.exe' : 'fnn';
    return join(this.installDir, binaryName);
  }

  /**
   * Get the path where the fnn-migrate binary should be installed
   */
  getMigrateBinaryPath(): string {
    const { platform } = this.getPlatformInfo();
    const binaryName = platform === 'win32' ? 'fnn-migrate.exe' : 'fnn-migrate';
    return join(this.installDir, binaryName);
  }

  /**
   * Check if the binary is installed and get its info
   */
  async getBinaryInfo(): Promise<BinaryInfo> {
    const binaryPath = this.getBinaryPath();
    const exists = existsSync(binaryPath);

    let version = 'unknown';
    let ready = false;

    if (exists) {
      try {
        const { stdout } = await execAsync(`"${binaryPath}" --version`);
        // Output format: "fnn Fiber v0.7.1 (f761b6d 2026-01-14)"
        // Extract the version number
        const versionMatch = stdout.match(/v(\d+\.\d+\.\d+)/);
        version = versionMatch ? versionMatch[1] : stdout.trim();
        ready = true;
      } catch {
        // Binary exists but may not be executable
        ready = false;
      }
    }

    return { path: binaryPath, version, ready };
  }

  /**
   * Fetch the latest release tag from GitHub (no API, follows redirect)
   */
  async getLatestTag(): Promise<string> {
    const response = await fetch(`${GITHUB_RELEASES_URL}/latest`, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'fiber-pay',
      },
    });

    const location = response.headers.get('location') || response.url;
    if (!location) {
      throw new Error(`Failed to resolve latest release tag (status: ${response.status})`);
    }

    const match = location.match(/\/tag\/([^/?#]+)/);
    if (!match) {
      throw new Error(`Failed to parse release tag from redirect: ${location}`);
    }

    return match[1];
  }

  /**
   * Normalize a version into a release tag
   */
  normalizeTag(version: string): string {
    const input = version.trim();
    if (!input) {
      throw new Error('Version cannot be empty');
    }

    const tag = input.startsWith('v') ? input : `v${input}`;
    if (!RELEASE_TAG_PATTERN.test(tag)) {
      throw new Error(
        `Invalid version format: ${version}. Expected semver-like tag, e.g. v0.7.1 or v0.7.1-rc.1`,
      );
    }

    return tag;
  }

  /**
   * Build download candidates for the current platform
   */
  buildAssetCandidates(tag: string): AssetCandidate[] {
    const { platform, arch } = this.getPlatformInfo();
    const extensions = platform === 'win32' ? ['zip', 'tar.gz'] : ['tar.gz'];
    const variants = platform === 'win32' ? ['', '-portable'] : ['-portable', ''];
    const patterns: Array<{ pattern: string; usesRosetta: boolean }> = [
      { pattern: BINARY_PATTERNS[platform][arch], usesRosetta: false },
    ];

    if (platform === 'darwin' && arch === 'arm64') {
      patterns.push({ pattern: BINARY_PATTERNS.darwin.x64, usesRosetta: true });
    }

    const candidates: AssetCandidate[] = [];
    for (const { pattern, usesRosetta } of patterns) {
      for (const variant of variants) {
        for (const ext of extensions) {
          const name = `fnn_${tag}-${pattern}${variant}.${ext}`;
          const url = `${GITHUB_RELEASES_URL}/download/${tag}/${name}`;
          candidates.push({ name, url, usesRosetta });
        }
      }
    }

    return candidates;
  }

  /**
   * Validate Rosetta support when falling back to x86_64 binary on Apple Silicon.
   */
  private async ensureRosettaAvailable(): Promise<void> {
    const { platform, arch } = this.getPlatformInfo();
    if (platform !== 'darwin' || arch !== 'arm64') {
      return;
    }

    try {
      await execAsync('arch -x86_64 /usr/bin/true');
    } catch {
      throw new Error(
        'Apple Silicon fallback selected x86_64 binary, but Rosetta 2 is not available. ' +
          'Install Rosetta with: softwareupdate --install-rosetta --agree-to-license',
      );
    }
  }

  /**
   * Download and install the Fiber binary
   */
  async download(options: DownloadOptions = {}): Promise<BinaryInfo> {
    const { version, force = false, onProgress = () => {} } = options;

    const binaryPath = this.getBinaryPath();

    // Check if already installed
    if (!force && existsSync(binaryPath)) {
      const info = await this.getBinaryInfo();
      if (info.ready) {
        onProgress({ phase: 'installing', message: `Binary already installed at ${binaryPath}` });
        return info;
      }
    }

    // Ensure install directory exists
    if (!existsSync(this.installDir)) {
      mkdirSync(this.installDir, { recursive: true });
    }

    // Resolve release tag
    onProgress({ phase: 'fetching', message: 'Resolving release tag...' });
    const tag = this.normalizeTag(version || DEFAULT_FIBER_VERSION);

    onProgress({ phase: 'fetching', message: `Found release: ${tag}` });

    // Build asset candidates
    const candidates = this.buildAssetCandidates(tag);

    let response: Response | undefined;
    let selected: AssetCandidate | undefined;
    const attempted: string[] = [];

    for (const candidate of candidates) {
      onProgress({
        phase: 'downloading',
        message: `Downloading ${candidate.name} from ${candidate.url}...`,
        percent: 0,
      });
      attempted.push(candidate.name);
      const candidateResponse = await fetch(candidate.url, {
        headers: { 'User-Agent': 'fiber-pay' },
      });

      if (candidateResponse.ok) {
        response = candidateResponse;
        selected = candidate;
        break;
      }
    }

    if (!response || !selected) {
      const attemptedUrls = candidates.map((candidate) => candidate.url).join(', ');
      throw new Error(`Download failed. Tried: ${attempted.join(', ')}. URLs: ${attemptedUrls}`);
    }

    onProgress({
      phase: 'downloading',
      message: `Using ${selected.name} (${selected.url})`,
    });

    if (selected.usesRosetta) {
      onProgress({
        phase: 'downloading',
        message: `No ARM64 binary available, using x86_64 version with Rosetta 2...`,
      });

      await this.ensureRosettaAvailable();

      onProgress({
        phase: 'downloading',
        message: `Rosetta 2 available, continuing with x86_64 fallback binary...`,
      });
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);

    // Stream download with progress
    const body = response.body;
    if (!body) {
      throw new Error('No response body');
    }

    let downloaded = 0;
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      downloaded += value.length;

      if (contentLength > 0) {
        const percent = Math.round((downloaded / contentLength) * 100);
        onProgress({
          phase: 'downloading',
          message: `Downloading... ${percent}%`,
          percent,
        });
      }
    }

    const buffer = Buffer.concat(chunks);

    // Handle different archive formats
    onProgress({ phase: 'extracting', message: 'Extracting binary...' });

    if (selected.name.endsWith('.tar.gz') || selected.name.endsWith('.tgz')) {
      await this.extractTarGz(buffer, binaryPath);
    } else if (selected.name.endsWith('.zip')) {
      await this.extractZip(buffer, binaryPath);
    } else {
      // Direct binary
      const { writeFile } = await import('node:fs/promises');
      await writeFile(binaryPath, buffer);
    }

    // Make executable (Unix)
    const { platform } = this.getPlatformInfo();
    if (platform !== 'win32') {
      chmodSync(binaryPath, 0o755);
    }

    onProgress({ phase: 'installing', message: `Installed to ${binaryPath}` });

    return this.getBinaryInfo();
  }

  /**
   * Extract tar.gz archive
   */
  private async extractTarGz(buffer: Buffer, targetPath: string): Promise<void> {
    const { writeFile, readdir, rename, rm } = await import('node:fs/promises');
    const tempDir = `${targetPath}.extract`;

    // Create temp directory
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // Write archive to temp file
    const archivePath = `${tempDir}/archive.tar.gz`;
    await writeFile(archivePath, buffer);

    // Extract using tar command
    try {
      await execAsync(`tar -xzf "${archivePath}" -C "${tempDir}"`);
    } catch (primaryError) {
      // Fallback: use Node's built-in zlib to avoid external `gunzip` dependency
      try {
        const { gunzipSync } = await import('node:zlib');
        const tarPath = `${tempDir}/archive.tar`;
        const tarBuffer = gunzipSync(buffer);
        await writeFile(tarPath, tarBuffer);
        await execAsync(`tar -xf "${tarPath}" -C "${tempDir}"`);
      } catch (fallbackError) {
        const primaryMessage =
          primaryError instanceof Error ? primaryError.message : String(primaryError);
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(
          `Failed to extract tar.gz archive. Primary: ${primaryMessage}. Fallback: ${fallbackMessage}`,
        );
      }
    }

    // Find the binary in extracted files
    const files = await readdir(tempDir, { recursive: true });
    const binaryFile = this.findBinaryInExtractedFiles(files, 'fnn');

    if (binaryFile) {
      const sourcePath = join(tempDir, String(binaryFile));
      await rename(sourcePath, targetPath);
    } else {
      // If no fnn found, maybe the archive contains a single binary
      const extractedFiles = await readdir(tempDir);
      const possibleBinary = extractedFiles.find(
        (f) => f !== 'archive.tar.gz' && !f.startsWith('.'),
      );
      if (possibleBinary) {
        await rename(join(tempDir, possibleBinary), targetPath);
      }
    }

    // Also extract fnn-migrate if present in the archive
    const migrateFile = this.findBinaryInExtractedFiles(files, 'fnn-migrate');

    if (migrateFile) {
      const migrateSourcePath = join(tempDir, String(migrateFile));
      const migrateTargetPath = this.getMigrateBinaryPath();
      try {
        // Proactively remove existing fnn-migrate so rename doesn't fail
        if (existsSync(migrateTargetPath)) {
          try {
            unlinkSync(migrateTargetPath);
          } catch {
            // If we can't remove the existing file, the rename will likely fail below
          }
        }
        await rename(migrateSourcePath, migrateTargetPath);
        const { platform } = this.getPlatformInfo();
        if (platform !== 'win32') {
          chmodSync(migrateTargetPath, 0o755);
        }
      } catch (error) {
        // fnn-migrate is optional; don't fail the main install, but warn
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `Warning: failed to install fnn-migrate helper. Migrations may be unavailable or stale. Error: ${message}`,
        );
      }
    }

    // Cleanup temp directory
    await rm(tempDir, { recursive: true, force: true });
  }

  /**
   * Extract zip archive (primarily for Windows)
   */
  private async extractZip(buffer: Buffer, targetPath: string): Promise<void> {
    const { writeFile, readdir, rename, rm } = await import('node:fs/promises');
    const tempDir = `${targetPath}.extract`;

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const archivePath = `${tempDir}/archive.zip`;
    await writeFile(archivePath, buffer);

    // Extract using unzip command
    const { platform } = this.getPlatformInfo();
    if (platform === 'win32') {
      await execAsync(
        `powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tempDir}'"`,
      );
    } else {
      await execAsync(`unzip -o "${archivePath}" -d "${tempDir}"`);
    }

    // Find and move the binary
    const files = await readdir(tempDir, { recursive: true });
    const binaryFile = this.findBinaryInExtractedFiles(files, 'fnn');

    if (binaryFile) {
      await rename(join(tempDir, String(binaryFile)), targetPath);
    }

    // Also extract fnn-migrate if present
    const migrateFile = this.findBinaryInExtractedFiles(files, 'fnn-migrate');

    if (migrateFile) {
      const migrateTargetPath = this.getMigrateBinaryPath();
      try {
        // Proactively remove existing fnn-migrate so rename doesn't fail
        if (existsSync(migrateTargetPath)) {
          try {
            unlinkSync(migrateTargetPath);
          } catch {
            // If we can't remove the existing file, the rename will likely fail below
          }
        }
        await rename(join(tempDir, String(migrateFile)), migrateTargetPath);
        const { platform } = this.getPlatformInfo();
        if (platform !== 'win32') {
          chmodSync(migrateTargetPath, 0o755);
        }
      } catch (error) {
        // fnn-migrate is optional; don't fail the main install, but warn
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `Warning: failed to install fnn-migrate helper. Migrations may be unavailable or stale. Error: ${message}`,
        );
      }
    }

    await rm(tempDir, { recursive: true, force: true });
  }

  /**
   * Remove the installed binary
   */
  async uninstall(): Promise<void> {
    const binaryPath = this.getBinaryPath();
    if (existsSync(binaryPath)) {
      unlinkSync(binaryPath);
    }
  }

  /**
   * Find a named binary in a list of extracted file paths.
   */
  private findBinaryInExtractedFiles(
    files: (string | Buffer)[],
    binaryName: 'fnn' | 'fnn-migrate',
  ): string | Buffer | undefined {
    return files.find((f) => {
      const name = String(f);
      return (
        name.endsWith(`/${binaryName}`) ||
        name === binaryName ||
        name.endsWith(`\\${binaryName}`) ||
        name.endsWith(`${binaryName}.exe`)
      );
    });
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Download the Fiber binary to the default location
 */
export async function downloadFiberBinary(options: DownloadOptions = {}): Promise<BinaryInfo> {
  const manager = new BinaryManager(options.installDir);
  return manager.download(options);
}

/**
 * Get information about the installed binary
 */
export async function getFiberBinaryInfo(installDir?: string): Promise<BinaryInfo> {
  const manager = new BinaryManager(installDir);
  return manager.getBinaryInfo();
}

/**
 * Ensure the Fiber binary is available, downloading if necessary.
 * If the binary exists but its version does not match the requested
 * (or default) version, it will be re-downloaded.
 */
export async function ensureFiberBinary(options: DownloadOptions = {}): Promise<string> {
  const manager = new BinaryManager(options.installDir);
  const info = await manager.getBinaryInfo();
  let downloadOptions = options;

  if (info.ready) {
    const wantedTag = manager.normalizeTag(options.version || DEFAULT_FIBER_VERSION);
    const wantedVersion = wantedTag.startsWith('v') ? wantedTag.slice(1) : wantedTag;
    if (info.version === wantedVersion) {
      return info.path;
    }
    // Version mismatch — force re-download.
    downloadOptions = { ...options, force: true };
  }

  const downloaded = await manager.download(downloadOptions);
  return downloaded.path;
}

/**
 * Get the default binary path
 */
export function getDefaultBinaryPath(): string {
  const manager = new BinaryManager();
  return manager.getBinaryPath();
}
