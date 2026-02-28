#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Dynamic package discovery
// ---------------------------------------------------------------------------

function discoverPackages() {
  const packagesDir = resolve(process.cwd(), 'packages');
  const nameByDir = new Map(); // dir name -> package name
  const entryPaths = new Set(); // public entrypoint source paths
  const manifestPaths = new Set(); // package.json paths

  if (!existsSync(packagesDir)) {
    return { nameByDir, entryPaths, manifestPaths };
  }

  for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgJsonPath = join('packages', dir.name, 'package.json');
    const absPkgJson = resolve(packagesDir, dir.name, 'package.json');

    if (!existsSync(absPkgJson)) continue;

    const pkg = JSON.parse(readFileSync(absPkgJson, 'utf8'));
    const pkgName = pkg.name || dir.name;

    nameByDir.set(dir.name, pkgName);
    manifestPaths.add(pkgJsonPath);

    // Derive public entrypoints from `exports` field
    if (pkg.exports) {
      const exportValues = typeof pkg.exports === 'string' ? [pkg.exports] : Object.values(pkg.exports);
      for (const val of exportValues) {
        const entry = typeof val === 'string' ? val : val?.import || val?.default;
        if (typeof entry === 'string') {
          // Map dist path back to src (e.g. ./dist/index.js -> src/index.ts)
          const srcPath = entry.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
          entryPaths.add(join('packages', dir.name, srcPath));
        }
      }
    }
  }

  return { nameByDir, entryPaths, manifestPaths };
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function printUsageAndExit(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    'Usage: node scripts/pr-change-summary.mjs --base <ref> --head <ref> [--json-out <file>] [--md-out <file>]',
  );
  process.exit(1);
}

function getArg(flag, defaultValue = undefined) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return defaultValue;

  const value = process.argv[index + 1];

  if (value === undefined || value.startsWith('--')) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    printUsageAndExit(`Missing value for ${flag}`);
  }

  return value;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function runGit(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...options });
}

function validateGitRef(ref, label) {
  if (!ref || ref.startsWith('-') || /[\0\r\n]/.test(ref)) {
    console.error(`Invalid ${label}: ${ref}`);
    process.exit(1);
  }

  try {
    runGit(['rev-parse', '--verify', `${ref}^{commit}`], { stdio: 'ignore' });
  } catch {
    console.error(`Git ref for ${label} does not resolve to a valid commit: ${ref}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Output / formatting helpers
// ---------------------------------------------------------------------------

function resolveSafeOutputPath(outputPath) {
  const normalized = normalize(outputPath);

  if (isAbsolute(normalized)) {
    console.error(`Output path must be relative to repository root: ${outputPath}`);
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const resolvedPath = resolve(repoRoot, normalized);
  const rel = relative(repoRoot, resolvedPath);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    console.error(`Output path escapes repository root: ${outputPath}`);
    process.exit(1);
  }

  return resolvedPath;
}

function sanitizeText(value) {
  return String(value).replace(/[\r\n\t]/g, ' ').trim();
}

function escapeMarkdownInline(value) {
  const text = sanitizeText(value)
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function clampList(items, maxItems = 25) {
  const unique = Array.from(new Set(items.map((item) => sanitizeText(item)).filter(Boolean)));
  if (unique.length <= maxItems) {
    return { items: unique, omitted: 0 };
  }
  return { items: unique.slice(0, maxItems), omitted: unique.length - maxItems };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const base = getArg('--base');
const head = getArg('--head');
const jsonOut = getArg('--json-out', 'pr-change-summary.json');
const mdOut = getArg('--md-out', 'pr-change-summary.md');

if (!base || !head) {
  printUsageAndExit();
}

validateGitRef(base, 'base ref');
validateGitRef(head, 'head ref');

const resolvedJsonOut = resolveSafeOutputPath(jsonOut);
const resolvedMdOut = resolveSafeOutputPath(mdOut);

// --- Discover packages dynamically ---
const { nameByDir, entryPaths: publicEntryPaths, manifestPaths: packageJsonPaths } = discoverPackages();

// --- Parse diff with NUL-delimited output for robustness ---
const nameStatus = runGit(['diff', '--name-status', '-z', `${base}...${head}`]);
const tokens = nameStatus.split('\0');
const entries = [];

for (let i = 0; i < tokens.length; ) {
  const token = tokens[i];
  if (!token) {
    i += 1;
    continue;
  }

  // Rename (R<score>) and Copy (C<score>) have two paths
  if (token.startsWith('R') || token.startsWith('C')) {
    const oldPath = tokens[i + 1] ?? '';
    const newPath = tokens[i + 2] ?? '';
    entries.push({ status: token[0], oldPath, path: newPath });
    i += 3;
    continue;
  }

  // Regular statuses: A, M, D, T, U, X — one path follows
  const filePath = tokens[i + 1] ?? '';
  entries.push({ status: token, path: filePath });
  i += 2;
}

// --- Map paths to packages (dynamic) ---
function mapPackage(path) {
  if (!path) return null;
  const match = path.match(/^packages\/([^/]+)\//);
  if (match) {
    return nameByDir.get(match[1]) || match[1];
  }
  if (path.startsWith('docs/')) return 'docs';
  if (path.startsWith('scripts/')) return 'scripts';
  if (path.startsWith('.github/')) return 'github-config';
  return 'root';
}

const affectedPackages = new Set();
for (const entry of entries) {
  affectedPackages.add(mapPackage(entry.path));
  if (entry.oldPath) {
    affectedPackages.add(mapPackage(entry.oldPath));
  }
}
affectedPackages.delete(null);

const apiSignals = [];
const breakingSignals = [];
const mediumSignals = [];

for (const entry of entries) {
  const currentPath = entry.path;
  const previousPath = entry.oldPath;

  if (publicEntryPaths.has(currentPath) || publicEntryPaths.has(previousPath)) {
    apiSignals.push(`Public entrypoint touched: ${currentPath}`);

    if (entry.status === 'D' || entry.status === 'R') {
      breakingSignals.push(`Public entrypoint removed or renamed: ${previousPath || currentPath}`);
    }

    const targetPath = currentPath || previousPath;
    const diff = runGit(['diff', '--unified=0', `${base}...${head}`, '--', targetPath]);
    const removedExports = diff
      .split('\n')
      .filter((line) => line.startsWith('-') && /^\s*export\b/.test(line.slice(1)));

    if (removedExports.length > 0) {
      breakingSignals.push(`Removed export statement(s) in ${targetPath}`);
    }
  }

  if (packageJsonPaths.has(currentPath)) {
    apiSignals.push(`Package manifest touched: ${currentPath}`);
    const diff = runGit(['diff', '--unified=0', `${base}...${head}`, '--', currentPath]);
    if (/^-\s*"exports"/m.test(diff) || /^-\s*"\.\//m.test(diff)) {
      breakingSignals.push(`Potential export contract removal in ${currentPath}`);
    } else {
      mediumSignals.push(`Potential package surface change in ${currentPath}`);
    }
  }

  if ((currentPath || '').startsWith('packages/cli/src/commands/') || (previousPath || '').startsWith('packages/cli/src/commands/')) {
    if (entry.status === 'D' || entry.status === 'R') {
      breakingSignals.push(`CLI command file removed or renamed: ${previousPath || currentPath}`);
    } else {
      mediumSignals.push(`CLI command tree changed: ${currentPath}`);
    }
  }

  if ((currentPath || '').startsWith('packages/runtime/src/proxy/')) {
    mediumSignals.push(`Runtime proxy contract touched: ${currentPath}`);
  }

  if ((currentPath || '').startsWith('.github/workflows/')) {
    mediumSignals.push(`Workflow changed: ${currentPath}`);
  }
}

if (Array.from(affectedPackages).filter((name) => name && name.startsWith('@fiber-pay/')).length > 1) {
  mediumSignals.push('Multiple workspace packages changed in one PR');
}

let riskLevel = 'low';
const riskReasons = [];

if (breakingSignals.length > 0) {
  riskLevel = 'high';
  riskReasons.push(...breakingSignals);
} else if (apiSignals.length > 0 || mediumSignals.length > 0) {
  riskLevel = 'medium';
  riskReasons.push(...apiSignals, ...mediumSignals);
} else {
  riskReasons.push('Only low-risk areas changed (docs/tests/internal files).');
}

const summary = {
  base,
  head,
  changedFileCount: entries.length,
  affectedPackages: Array.from(affectedPackages).sort(),
  risk: {
    level: riskLevel,
    reasons: Array.from(new Set(riskReasons)),
  },
  signals: {
    api: Array.from(new Set(apiSignals)),
    medium: Array.from(new Set(mediumSignals)),
    breaking: Array.from(new Set(breakingSignals)),
  },
  changedFiles: entries,
};

const marker = '<!-- pr-change-summary -->';
const safeRiskReasons = clampList(summary.risk.reasons);
const safeAffectedPackages = clampList(summary.affectedPackages, 12);

const markdown = [
  marker,
  '## PR Change Summary',
  '',
  `- **Risk Level**: ${summary.risk.level.toUpperCase()}`,
  `- **Changed Files**: ${summary.changedFileCount}`,
  `- **Affected Packages**: ${safeAffectedPackages.items.length > 0 ? safeAffectedPackages.items.map((item) => `\`${escapeMarkdownInline(item)}\``).join(', ') : 'none'}`,
  '',
  '### Risk Reasons',
  ...safeRiskReasons.items.map((reason) => `- ${escapeMarkdownInline(reason)}`),
  ...(safeRiskReasons.omitted > 0 ? [`- ...and ${safeRiskReasons.omitted} more reason(s)`] : []),
  '',
  '### Interface Signals',
  `- API touched: ${summary.signals.api.length}`,
  `- Potential breaking signals: ${summary.signals.breaking.length}`,
  '',
  '### Notes',
  '- This report is rule-based (deterministic), not LLM-generated.',
].join('\n');

const MAX_MARKDOWN_LENGTH = 60000;
const finalMarkdown = markdown.length > MAX_MARKDOWN_LENGTH
  ? `${markdown.slice(0, MAX_MARKDOWN_LENGTH - 80)}\n\n- Output truncated for size safety.\n`
  : markdown;

mkdirSync(dirname(resolvedJsonOut), { recursive: true });
mkdirSync(dirname(resolvedMdOut), { recursive: true });
writeFileSync(resolvedJsonOut, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
writeFileSync(resolvedMdOut, `${finalMarkdown}\n`, 'utf8');

console.log(`Wrote ${resolvedJsonOut}`);
console.log(`Wrote ${resolvedMdOut}`);
