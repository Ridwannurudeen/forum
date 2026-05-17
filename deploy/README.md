# Continuous deployment — `forum-keeper.service`

The reference V2 market-making keeper runs as a `systemd` service on a VPS so
the bot's TrackRecord publish to Arc is *continuous*, not bursty. This is
load-bearing for the project's "real traction during the event window" story.

## Layout on the VPS

```
/opt/forum/
├── deployments/
│   └── arc-testnet.json
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
