# Continuous deployment — `forum-keeper.service`

The reference V2 market-making keeper runs as a `systemd` service on a VPS so
the bot's TrackRecord publish to Arc is *continuous*, not bursty. This is
load-bearing for the project's "real traction during the event window" story.

## Layout on the VPS

```
/opt/forum/
├── deployments/
│   ├── arc-testnet.json
│   └── arc-mainnet.json   # mainnet manifest (schema below)
├── forum.env              # OPTIONAL network switch — absent = testnet (see "Mainnet cut-over")
├── indexer-state.json             # testnet indexer snapshot
├── indexer-state-mainnet.json     # mainnet indexer snapshot (FORUM_INDEXER_STATE)
├── enable-nginx.sh        # one-shot to enable forum.gudman.xyz once DNS resolves
├── keeper/                # the rsync'd keeper/ workspace from this repo
│   ├── node_modules/
│   ├── package.json
│   ├── tsconfig.json
│   ├── scripts/
│   └── src/
└── web/
    └── index.html         # frontend (served by nginx)

/root/.forum-keys/deployer.key   # mode 600, never committed
/etc/systemd/system/forum-keeper.service
```

## Setup (one-time)

```bash
# 1. SCP repo to VPS
ssh root@gudman.xyz "mkdir -p /opt/forum/keeper /opt/forum/deployments /root/.forum-keys"
scp keeper/package.json keeper/tsconfig.json   root@gudman.xyz:/opt/forum/keeper/
scp keeper/src/*.ts                            root@gudman.xyz:/opt/forum/keeper/src/
scp keeper/scripts/*.mjs                       root@gudman.xyz:/opt/forum/keeper/scripts/
scp deployments/arc-testnet.json               root@gudman.xyz:/opt/forum/deployments/
scp ~/.forum-keys/deployer.key                 root@gudman.xyz:/root/.forum-keys/deployer.key
ssh root@gudman.xyz "chmod 600 /root/.forum-keys/deployer.key"

# 2. npm install
ssh root@gudman.xyz "cd /opt/forum/keeper && npm install --silent"

# 3. systemd unit
scp deploy/forum-keeper.service                root@gudman.xyz:/etc/systemd/system/
ssh root@gudman.xyz "systemctl daemon-reload && systemctl enable --now forum-keeper.service"
```

## Operate

```bash
# liveness
ssh root@gudman.xyz "systemctl is-active forum-keeper && systemctl status forum-keeper --no-pager"

# live tail
ssh root@gudman.xyz "journalctl -u forum-keeper -f"

# recent log
ssh root@gudman.xyz "journalctl -u forum-keeper -n 50 --no-pager"

# restart (e.g., after pushing new keeper code)
ssh root@gudman.xyz "systemctl restart forum-keeper"

# stop / disable
ssh root@gudman.xyz "systemctl disable --now forum-keeper.service"
```

## Cadence

With `--markets 5 --interval 60 --publish-every 10` the keeper:

- polls 5 Polymarket V2 markets every 60 seconds
- publishes a `TrackRecord` to Arc every 10 ticks ≈ 10 minutes
- ≈ 144 publishes/day, ≈ 1,000+ over the May 11–25 hackathon window

Gas burn: each `TrackRecord.publish` costs ~$0.01 USDC on Arc; 1 USDC = 100 publishes.
The deployer wallet has 100 USDC at deploy → ample headroom.

## Upgrading the keeper code

```bash
# from repo root
rsync -av --delete keeper/src/   root@gudman.xyz:/opt/forum/keeper/src/
rsync -av --delete keeper/scripts/   root@gudman.xyz:/opt/forum/keeper/scripts/
ssh root@gudman.xyz "systemctl restart forum-keeper"
```

## Network selection (env)

Every keeper, operator script and the indexer reads the network from the
environment. Nothing is set → Arc testnet, exactly as before.

| Variable | Default | Read by |
|---|---|---|
| `FORUM_CHAIN` | `arc-testnet` | everything. `arc-mainnet` selects chain 5042 (`keeper/src/chain.ts`, `arcChain()`), which also pins every write to `maxFeePerGas >= 21 gwei` — Arc mainnet drops sub-20-gwei transactions silently. |
| `FORUM_DEPLOYMENTS` | `deployments/<FORUM_CHAIN>.json` (repo-relative) | everything. The manifest's `chainId` must match `FORUM_CHAIN` or startup fails. |
| `ARC_RPC_URL` | chain default (`https://rpc.testnet.arc.network` / `https://rpc.mainnet.arc.io`) | everything. The mainnet env file sets `https://rpc.blockdaemon.mainnet.arc.io`: the public mainnet RPC rate-limits the indexer's log catch-up. |
| `FORUM_INDEXER_RPC` | `ARC_RPC_URL` | indexer only (wins over `ARC_RPC_URL`) |
| `ARC_RPC` | `ARC_RPC_URL` | stale-enforcer, idle-policy, fee-reconcile (wins over `ARC_RPC_URL`) |
| `FORUM_INDEXER_STATE` | `/opt/forum/indexer-state.json` | indexer. Use a separate file per chain. |
| `FORUM_INDEXER_PORT`, `FORUM_INDEXER_POLL_MS` | `3060`, `30000` | indexer (unchanged) |

Contracts the manifest lacks switch their features off instead of crashing:
on mainnet there is no v1 `TrackRecord` (only V2 bots are indexed, `/api/bots/:id/records`
reads V2), no v1 `CovenantVaultFactory` (`/api/fee-statement`, `fee-reconcile.mjs` and
`idle-capital-policy.mjs` enumerate `CovenantVaultFactoryV2.allVaults()`), and
`SlashBond` replaces `SlashBondV1_1` in `/api/state.bonds`. `/api/cctp/attestation`
relays `https://iris-api.circle.com` on mainnet (sandbox on testnet). The AgoraMind
keeper binds to `contracts.CovenantVaultV3` by default on mainnet (V1.2 on testnet).

The indexer also catches up incrementally: at most 47,500 blocks per poll, cursor
persisted after every 9,500-block chunk, and RPC failures back off exponentially
(30 s → 10 min cap) instead of re-polling the same range every 30 s.

## Mainnet cut-over

`/opt/forum/forum.env` is the single switch. The units that load it
(`EnvironmentFile=-/opt/forum/forum.env`): `forum-indexer`, `forum-stale-enforcer`,
`forum-idle-policy`, `forum-fee-reconcile`, and the new `forum-agora-mind-mainnet`
(which **requires** the file). `forum-keeper` (v1 TrackRecord keeper — no mainnet
counterpart exists) and the testnet `forum-agora-mind` do **not** load it, so they
can never be flipped by accident; they must be stopped explicitly, because both
AgoraMind units derive their botId from the same deployer key.

```bash
# 0. Prerequisite: deployments/arc-mainnet.json lists every contract (schema below).
scp deployments/arc-mainnet.json                root@gudman.xyz:/opt/forum/deployments/
rsync -av --delete keeper/src/     root@gudman.xyz:/opt/forum/keeper/src/
rsync -av --delete keeper/scripts/ root@gudman.xyz:/opt/forum/keeper/scripts/

# 1. Stop the testnet publishers first (one deployer key, one bot per chain).
ssh root@gudman.xyz "systemctl disable --now forum-agora-mind forum-keeper"

# 2. The switch. Review before copying; no secrets go in it.
scp deploy/forum-mainnet.env.example            root@gudman.xyz:/opt/forum/forum.env
ssh root@gudman.xyz "chmod 600 /opt/forum/forum.env"

# 3. Units: refreshed EnvironmentFile= lines + the new mainnet AgoraMind unit.
scp deploy/forum-indexer.service deploy/forum-stale-enforcer.service \
    deploy/forum-idle-policy.service deploy/forum-fee-reconcile.service \
    deploy/forum-agora-mind-mainnet.service     root@gudman.xyz:/etc/systemd/system/
ssh root@gudman.xyz "systemctl daemon-reload && systemctl restart forum-indexer && systemctl enable --now forum-agora-mind-mainnet"

# 4. Verify: chain 5042 in the indexer boot line and in /api/fee-statement.
ssh root@gudman.xyz "journalctl -u forum-indexer -n 5 --no-pager | grep 'chain=arc-mainnet (5042)'"
ssh root@gudman.xyz "curl -s localhost:3060/api/fee-statement | jq '{chain, chainId, factory, vaultCount}'"
ssh root@gudman.xyz "journalctl -u forum-agora-mind-mainnet -n 20 --no-pager"
```

`forum-agora-mind-mainnet.service` publishes every 60 ticks (≈ 1 h) under the label
`forum-agora-mind-mainnet-v1`; the testnet unit keeps `--publish-every 10` and its
own label. The indexer starts a fresh mainnet snapshot at the lowest deploy block
in the manifest (TrackRecordV2) and walks forward 47,500 blocks per poll.

Rollback: `rm /opt/forum/forum.env`, `systemctl disable --now forum-agora-mind-mainnet`,
`systemctl restart forum-indexer`, `systemctl enable --now forum-agora-mind forum-keeper`.
The testnet snapshot at `/opt/forum/indexer-state.json` is untouched throughout.

Recovery on mainnet: `FORUM_CHAIN=arc-mainnet tsx keeper/scripts/agora-mind-recover.mjs`
(defaults to label `forum-agora-mind-mainnet-v1` and unit `forum-agora-mind-mainnet`;
override with `--label` / `--unit`).

## Manifest schema — `deployments/arc-mainnet.json`

Top level: `chainId` (5042), `rpc`, `explorer`, `deployer`, `usdc`, `usdcDecimals`,
`nativeDecimals`, `gas` (`baseFeeFloorGwei` 20 / `usedGasPriceGwei` 21), `contracts`,
`verification`, `notDeployed`, `notClaimed`. Every entry under `contracts` carries at
least `address`, `txHash` and `block` (a number; the indexer's initial cursor is the
lowest `block` present). After the V2 stack is deployed `contracts` holds exactly:

| Key | Extra fields | Consumers |
|---|---|---|
| `TrackRecordV2` | `registerBotTxHash`, `registerBotBlock` | keeper, indexer, stale-enforcer, recover |
| `PolicyVault` | owner / agent / botId / categories / payees… | policy-keeper (`POLICY_VAULT_ADDRESS`), docs |
| `RiskKernelV2` | — | indexer (`Enforced` events), stale-enforcer, AgoraMind keeper, recover |
| `CovenantVaultFactoryV2` | — | indexer (`VaultCreated`, `/api/fee-statement`), fee-reconcile, idle-policy |
| `CapitalRouter` | — | indexer (router events, `/api/router/*`), stale-enforcer |
| `FeeRouterV1` | — | indexer (`/api/fees`, `/api/fee-statement`), fee-reconcile |
| `SlashBond` | `operator`, `attestor`, `recipient`, `botId`, `label` | indexer bonds (label shown as-is) |
| `CovenantVaultV3` | `botId`, `budgetUsdc`, `receiptFreshnessSec` | indexer hard-coded vault `v3`, AgoraMind default vault, recover |

Legacy keys (`TrackRecord`, `BuilderCodeRegistry`, `KeeperConfig`, `FeeDistributor`,
`CovenantVault`, `CovenantVaultV1_1`, `CovenantVaultV1_2`, `CovenantVaultV2`,
`CovenantVaultFactory`, `SlashBondV1_1`, `AgentPool`, `DemoLive*`, …) exist only in
`arc-testnet.json`; every consumer treats them as optional.
