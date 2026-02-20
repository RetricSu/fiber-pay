# Install

You can install from npm (recommended for consumers) or from source (recommended for contributors).

## Prerequisites

- Node.js `>=20`

## Install from npm

```bash
npm install -g @fiber-pay/cli
```

## Install from source

Make sure you have:

- `pnpm`
- `git`

```bash
git clone https://github.com/RetricSu/fiber-pay.git && cd fiber-pay
pnpm install
pnpm build
cd packages/cli && pnpm link --global
```

### Update after pulling new changes

```bash
git pull
pnpm install
pnpm build
cd packages/cli && pnpm link --global
```

## Verify CLI is available

```bash
fiber-pay --version
fiber-pay -h
```

## Notes

- npm release is tag-driven in CI (`.github/workflows/release.yml`) using `vX.Y.Z` tags.
- Stable tags publish to npm `latest`; pre-release tags (such as `-rc`) publish to `next`.
- For exact command behavior and flags after install, use progressive help:
  - `fiber-pay -h`
  - `fiber-pay <group> -h`
  - `fiber-pay <group> <cmd> -h`
