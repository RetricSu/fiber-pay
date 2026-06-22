---
"@fiber-pay/node": patch
---

Fix `BinaryManager` silently keeping or reporting the wrong `fnn` version for pre-release tags (e.g. `v0.9.0-rc4`). The version regex now captures the full semver including pre-release and build suffixes, `download()` only skips re-download when the installed version actually matches the requested tag, and a post-install version check raises an explicit error instead of reporting success on a mismatched binary. (issue #166)
