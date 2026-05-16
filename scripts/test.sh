#!/usr/bin/env bash
# Run forge tests for all Forum contracts.
# Usage:  bash scripts/test.sh

set -euo pipefail

if ! command -v forge >/dev/null 2>&1; then
    echo "ERROR: forge not in PATH. Try:" >&2
    echo "  export PATH=\"/c/Users/gudma/.foundry/bin:\$PATH\"" >&2
    exit 1
fi

if [[ ! -d lib/forge-std ]]; then
    echo "Installing forge-std..."
    forge install foundry-rs/forge-std --no-git
fi

forge build
forge test -vv
