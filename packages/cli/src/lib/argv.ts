const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '--profile',
  '--data-dir',
  '--rpc-url',
  '--network',
  '--key-password',
  '--binary-path',
]);

function isOptionToken(token: string): boolean {
  return token.startsWith('-') && token !== '-';
}

function hasInlineValue(token: string): boolean {
  return token.includes('=');
}

function getFirstPositional(argv: string[]): string | undefined {
  for (let index = 2; index < argv.length; index++) {
    const token = argv[index];

    if (token === '--') {
      return argv[index + 1];
    }

    if (!isOptionToken(token)) {
      return token;
    }

    if (GLOBAL_OPTIONS_WITH_VALUE.has(token) && !hasInlineValue(token)) {
      const next = argv[index + 1];
      if (next && !isOptionToken(next)) {
        index++;
      }
    }
  }

  return undefined;
}

function hasTopLevelVersionFlag(argv: string[]): boolean {
  for (let index = 2; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--') {
      return false;
    }
    if (token === '--version' || token === '-v') {
      return true;
    }
  }
  return false;
}

export function isTopLevelVersionRequest(argv: string[]): boolean {
  return !getFirstPositional(argv) && hasTopLevelVersionFlag(argv);
}
