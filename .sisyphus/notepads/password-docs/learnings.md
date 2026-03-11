# Password Documentation Accumulated Findings

## Source Material Summary

### profile.md (lines 25-50)
- Contains key resolution priority table showing password lookup order
- Key password priority: CLI flag → profile.json → env FIBER_KEY_PASSWORD
- Profile management commands: show, set, unset

### configuration.md (lines 40-42, 50-52)
- Confirms profile.json scope includes keyPassword
- References FIBER_SECRET_KEY_PASSWORD (upstream FNN env var)

### config.ts (lines 241-249)
- Implementation shows exact priority logic:
  ```typescript
  const cliKeyPassword = explicitFlags?.has('keyPassword') ? process.env.FIBER_KEY_PASSWORD : undefined;
  const profileKeyPassword = profile?.keyPassword;
  const envKeyPassword = !explicitFlags?.has('keyPassword') ? process.env.FIBER_KEY_PASSWORD : undefined;
  const keyPassword = cliKeyPassword || profileKeyPassword || envKeyPassword || undefined;
  ```

### crypto.ts
- Encryption constants defined:
  - SCRYPT_N = 2^14
  - SCRYPT_R = 8
  - SCRYPT_P = 1
  - KEY_LENGTH = 32
  - SALT_LENGTH = 32
  - IV_LENGTH = 16
  - AUTH_TAG_LENGTH = 16
- Magic bytes: 'FIBERENC' (0x46, 0x49, 0x42, 0x45, 0x52, 0x45, 0x4e, 0x43)
- Uses scrypt from @noble/hashes/scrypt.js
- Uses Web Crypto API for AES-GCM

## Default Password

From code review, the default password used when no explicit password is provided:
- Value: 'fiber-pay-default-key'
- Used in development/testing scenarios
- Documented with general guidance (not alarmist warnings)

## Document Structure Decisions

1. Created comprehensive single-file documentation
2. Included priority table for clarity
3. Documented encryption parameters with technical accuracy
4. Kept default password section informative but not fear-mongering
5. Added production best practices section
6. Included return link to references/ directory

## File Locations

- Output: /Users/retric/Desktop/fiber-pay/skills/fiber-pay/references/password-management.md
- Notepad: /Users/retric/Desktop/fiber-pay/.sisyphus/notepads/password-docs/learnings.md
