#!/usr/bin/env bash
# Deploy Forum contracts to Arc testnet.
# Reads the deployer private key from ~/.forum-keys/deployer.key
# (the key NEVER lives in the repo).
#
# Usage:  bash scripts/deploy.sh

set -euo pipefail

KEYFILE="${HOME}/.forum-keys/deployer.key"
if [[ ! -f "${KEYFILE}" ]]; then
    echo "ERROR: ${KEYFILE} not found." >&2
    echo "Run the wallet-generation step first." >&2
    exit 1
fi

if [[ ! -f .env ]]; then
    echo "ERROR: .env not found. Copy .env.example to .env first:" >&2
    echo "  cp .env.example .env" >&2
    exit 1
fi

# Source non-secret env (RPC URL, USDC address, etc.)
set -a
# shellcheck disable=SC1091
source .env
set +a

export DEPLOYER_PRIVATE_KEY
DEPLOYER_PRIVATE_KEY="$(cat "${KEYFILE}")"

if ! command -v forge >/dev/null 2>&1; then
    echo "ERROR: forge not in PATH. Try:" >&2
    echo "  export PATH=\"/c/Users/gudma/.foundry/bin:\$PATH\"" >&2
    exit 1
fi

echo "Deploying Forum contracts to Arc testnet (chain 5042002)..."
forge script script/Deploy.s.sol \
    --rpc-url "${ARC_TESTNET_RPC_URL}" \
    --broadcast \
    --legacy \
    -vvv
