# Password Management

This document explains how password management works in fiber-pay CLI for encrypting and decrypting private keys.

## Overview

fiber-pay uses passwords to protect private key files stored on disk. The same password mechanism works for both Fiber Network keys and CKB keys. Passwords are never stored in plaintext; they are used only at runtime to decrypt keys into memory.

## Password Configuration Methods

You can provide passwords through three different mechanisms:

### 1. CLI Flag

Pass the password directly via command line:

```bash
fiber-pay node start --key-password "your-password"
```

### 2. Profile Configuration

Store the password in your profile's `profile.json` file:

```bash
fiber-pay config profile set keyPassword "your-password"
```

This stores the password in `<data-dir>/profile.json` and persists across CLI invocations for that profile.

### 3. Environment Variable

Set the password in your shell environment:

```bash
export FIBER_KEY_PASSWORD="your-password"
fiber-pay node start
```

## Priority Order

When multiple password sources are available, fiber-pay resolves them in this order:

| Priority | Source | How it is set |
|----------|--------|---------------|
| 1 (highest) | CLI flag | `--key-password` argument |
| 2 | Profile | `keyPassword` in `profile.json` |
| 3 (lowest) | Environment | `FIBER_KEY_PASSWORD` env var |

The first available password in this chain is used. If no password is provided through any of these methods, the system falls back to the default password.

## Key File Storage

Private keys are stored in specific locations within your data directory:

### Fiber Secret Key

- **Path**: `<data-dir>/fiber/sk`
- **Format**: Encrypted binary or plaintext (if generated without encryption)
- **Auto-generated**: Created automatically on first `node start` if missing

### CKB Key

- CKB keys follow similar storage patterns
- Encrypted using the same password mechanism

### File Permissions

Key files should have restricted permissions (0o600) to ensure only the owner can read/write them. The CLI attempts to set these permissions automatically when creating key files.

## Encryption Technology

fiber-pay uses industry-standard encryption for key protection:

### Algorithm: scrypt + AES-256-GCM

The encryption scheme combines scrypt key derivation with AES-256-GCM authenticated encryption:

| Component | Details |
|-----------|---------|
| Key Derivation | scrypt (RFC 7914) |
| Encryption | AES-256-GCM |
| Scrypt Parameters | N=2^14, r=8, p=1 |
| Derived Key Length | 32 bytes |
| Salt Length | 32 bytes |
| IV Length | 16 bytes |
| Auth Tag | 16 bytes |

### Encryption Format

Encrypted keys are stored with a magic header (`FIBERENC` in ASCII) followed by:

1. Salt (32 bytes) - random per encryption
2. IV (16 bytes) - random per encryption
3. Auth Tag (16 bytes) - GCM authentication tag
4. Ciphertext - the encrypted key material

This format allows the system to detect encrypted vs plaintext keys and apply appropriate decryption when the password is provided.

### Security Properties

- **Memory safety**: Decrypted keys exist only in memory during operation
- **No password storage**: Passwords are never persisted (except optionally in profile.json)
- **Authenticated encryption**: AES-GCM prevents tampering with encrypted key files
- **Random salts**: Each encryption uses unique salt, preventing rainbow table attacks

## Default Password

For convenience in development and testing scenarios, fiber-pay includes a default password that is used when no explicit password is provided:

```
fiber-pay-default-key
```

When you start a node without configuring a custom password, the system automatically uses this default. This simplifies initial setup but means your keys are protected only by a well-known default.

Consider setting a custom password when:

- Running in production environments
- Storing significant amounts of funds
- Sharing a machine with other users
- Requiring compliance with security policies

## Production Best Practices

For production deployments, follow these recommendations:

### 1. Use Strong Passwords

Generate passwords with sufficient entropy (16+ characters, mixed case, numbers, symbols).

### 2. Prefer Environment Variables for Production

Set `FIBER_KEY_PASSWORD` via your deployment orchestration (Docker secrets, Kubernetes secrets, etc.) rather than storing in profile.json.

### 3. Never Commit Passwords

Avoid storing passwords in version control or configuration files that might be shared.

### 4. Profile Isolation

Use separate profiles for different environments:

```bash
# Production profile
fiber-pay --profile prod config profile set keyPassword "$PROD_PASSWORD"

# Development profile (can use default or weak password)
fiber-pay --profile dev node start
```

### 5. Key Backup

Back up your `<data-dir>/fiber/sk` file securely. Remember that backups are encrypted with your password; you will need the same password to decrypt them.

### 6. Permission Checks

Verify key file permissions periodically:

```bash
ls -l ~/.fiber-pay/fiber/sk
# Should show: -rw------- (600 permissions)
```

## Related Topics

- [Profile & Multi-Node Guide](./profile.md)
- [Configuration Reference](./configuration.md)

---

[← Back to references](./)
