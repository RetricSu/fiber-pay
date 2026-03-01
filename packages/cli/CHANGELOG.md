# @fiber-pay/cli

## 0.1.0-rc.4

### Patch Changes

- cabeae2: Improve upgrade and migration safety/UX:

  - simplify `fiber-pay node upgrade` flags by removing ambiguous `--force`
  - make `--force-migrate` attempt migration even when compatibility pre-check is incompatible
  - normalize migration hints so users are guided by CLI commands instead of raw `fnn-migrate` invocations
  - add strict version-tag validation in binary download flow to prevent malformed/path-like version input
  - add migration/status messaging improvements and post-migration check warning when refresh fails

- Updated dependencies [cabeae2]
  - @fiber-pay/node@0.1.0-rc.4
  - @fiber-pay/sdk@0.1.0-rc.4
  - @fiber-pay/runtime@0.1.0-rc.4
