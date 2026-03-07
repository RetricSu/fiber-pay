---
"@fiber-pay/cli": patch
---

Add `config profile list` command to list available Fiber profiles

- Lists all profile subdirectories in `~/.fiber-pay/profiles/`
- Shows 'default' profile if `~/.fiber-pay/config.yml` exists
- Supports `--json` flag for machine-readable output
- Profiles sorted alphabetically with 'default' at the top

Closes #70
