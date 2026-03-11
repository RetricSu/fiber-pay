---
"@fiber-pay/cli": patch
---

Add `--qrcode` flag to `wallet address` command.

- Add `--qrcode` option to display the funding address as a QR code in the terminal
- Show truncated address (e.g., `ckt1qzda...9z7s0v0t`) below the QR code for reference
- Add `qrcode` library as a dependency
