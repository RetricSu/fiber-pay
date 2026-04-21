#!/bin/sh
# boxlite-setup.sh — Setup script for BoxLite Alpine Linux container
#
# Run this once inside the BoxLite box to enable per-session Linux namespace
# isolation for `fiber-pay agent serve`.
#
# What it does:
#   1. Installs util-linux (provides full-featured `unshare` on Alpine)
#   2. Creates the session directory structure under /workspace and /tmp
#   3. Probes whether the kernel allows unprivileged user namespaces
#
# Usage:
#   # Via BoxLite exec API, or manually inside the box:
#   sh boxlite-setup.sh
#
# If probe fails, check on the host:
#   sysctl kernel.unprivileged_userns_clone   # must be 1
# Or set permanently:
#   echo 'kernel.unprivileged_userns_clone = 1' >> /etc/sysctl.conf && sysctl -p

set -e

echo "=== BoxLite Container Setup ==="
echo ""

# ---------------------------------------------------------------------------
# 1. Install util-linux for full unshare support
# ---------------------------------------------------------------------------
echo "[1/3] Checking unshare..."

if command -v apk > /dev/null 2>&1; then
  # Alpine Linux — BusyBox unshare lacks some namespace flags; install util-linux
  echo "      Alpine detected, installing util-linux..."
  apk add --no-cache util-linux
  echo "      util-linux installed."
else
  # Non-Alpine: verify unshare is already present
  if ! command -v unshare > /dev/null 2>&1; then
    echo "ERROR: unshare not found. Install util-linux for your distro."
    exit 1
  fi
  echo "      unshare available (non-Alpine, skipping install)."
fi
echo ""

# ---------------------------------------------------------------------------
# 2. Create workspace directory structure
# ---------------------------------------------------------------------------
echo "[2/3] Creating workspace directories..."

mkdir -p /workspace/sessions
chmod 755 /workspace/sessions
echo "      /workspace/sessions       OK"

mkdir -p /tmp/fiber-sessions
chmod 1777 /tmp/fiber-sessions
echo "      /tmp/fiber-sessions       OK"

echo ""

# ---------------------------------------------------------------------------
# 3. Probe namespace isolation capability
# ---------------------------------------------------------------------------
echo "[3/3] Probing Linux namespace support..."

ns_user=0
ns_full=0

# Probe: basic user namespace
if unshare --user --fork --map-root-user sh -c "echo ok" > /dev/null 2>&1; then
  echo "      user namespace:            OK"
  ns_user=1
else
  echo "      user namespace:            FAILED"
fi

# Probe: full isolation (user + pid + mount + proc remount)
if unshare --user --pid --mount --fork --map-root-user --mount-proc \
     sh -c "echo ok" > /dev/null 2>&1; then
  echo "      pid + mount namespace:     OK"
  ns_full=1
else
  echo "      pid + mount namespace:     FAILED"
fi

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
if [ "$ns_full" = "1" ]; then
  echo "=== Setup complete — full namespace isolation AVAILABLE ==="
  echo "    Each agent session will run in isolated PID + mount namespaces."
elif [ "$ns_user" = "1" ]; then
  echo "=== Setup complete — partial namespace isolation only ==="
  echo "    User namespace works but pid/mount probe failed."
  echo "    Check kernel seccomp/AppArmor restrictions."
else
  echo "=== Setup complete — namespace isolation NOT AVAILABLE ==="
  echo "    Falling back to directory-only isolation."
  echo ""
  echo "    To enable unprivileged user namespaces on the host:"
  echo "      sysctl -w kernel.unprivileged_userns_clone=1"
  echo "    Or permanently:"
  echo "      echo 'kernel.unprivileged_userns_clone = 1' >> /etc/sysctl.conf"
  echo "      sysctl -p"
fi
