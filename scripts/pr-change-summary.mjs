#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path';

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

function runGit(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...options });
}

function validateGitRef(ref, label) {
  if (!ref || /[\0\r\n]/.test(ref)) {
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

const nameStatus = runGit(['diff', '--name-status', `${base}...${head}`]);
const entries = nameStatus
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const parts = line.split('\t');
    const rawStatus = parts[0] || '';

    if (rawStatus.startsWith('R')) {
      return {
        status: 'R',
        oldPath: parts[1],
        path: parts[2],
      };
    }

    return {
      status: rawStatus,
      path: parts[1],
    };
  });

function mapPackage(path) {
  if (!path) return null;
  if (path.startsWith('packages/sdk/')) return '@fiber-pay/sdk';
  if (path.startsWith('packages/node/')) return '@fiber-pay/node';
  if (path.startsWith('packages/runtime/')) return '@fiber-pay/runtime';
  if (path.startsWith('packages/agent/')) return '@fiber-pay/agent';
  if (path.startsWith('packages/cli/')) return '@fiber-pay/cli';
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

const publicEntryPaths = new Set([
  'packages/sdk/src/index.ts',
  'packages/node/src/index.ts',
  'packages/runtime/src/index.ts',
  'packages/agent/src/index.ts',
  'packages/cli/src/index.ts',
]);

const packageJsonPaths = new Set([
  'packages/sdk/package.json',
  'packages/node/package.json',
  'packages/runtime/package.json',
  'packages/agent/package.json',
  'packages/cli/package.json',
]);

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
const markdown = [
  marker,
  '## PR Change Summary',
  '',
  `- **Risk Level**: ${summary.risk.level.toUpperCase()}`,
  `- **Changed Files**: ${summary.changedFileCount}`,
  `- **Affected Packages**: ${summary.affectedPackages.length > 0 ? summary.affectedPackages.join(', ') : 'none'}`,
  '',
  '### Risk Reasons',
  ...summary.risk.reasons.map((reason) => `- ${reason}`),
  '',
  '### Interface Signals',
  `- API touched: ${summary.signals.api.length}`,
  `- Potential breaking signals: ${summary.signals.breaking.length}`,
  '',
  '### Notes',
  '- This report is rule-based (deterministic), not LLM-generated.',
].join('\n');

mkdirSync(dirname(resolvedJsonOut), { recursive: true });
mkdirSync(dirname(resolvedMdOut), { recursive: true });
writeFileSync(resolvedJsonOut, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
writeFileSync(resolvedMdOut, `${markdown}\n`, 'utf8');

console.log(`Wrote ${resolvedJsonOut}`);
console.log(`Wrote ${resolvedMdOut}`);
