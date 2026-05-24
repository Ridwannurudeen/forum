"""
Forum adapter template — Python reference.

Run with:
    FORUM_BOT_LABEL=my-bot-v1 \\
    RECEIPT_BASE_URL=https://my-bot.example.com/receipts \\
    FORUM_PRIVATE_KEY=0x... \\
    python3 adapters/template/adapter.py

Requires:
    pip install forum-arc web3 eth-account
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass

from eth_account import Account
from web3 import Web3

from forum_arc import ForumClient
from forum_arc.deployments import ARC_TESTNET_DEPLOYMENT
from forum_arc.abi import TRACK_RECORD_V2_ABI


BOT_LABEL = os.environ.get("FORUM_BOT_LABEL", "template-bot-v1")
RECEIPTS_BASE_URL = os.environ.get("RECEIPT_BASE_URL", "https://example.com/receipts")
PUBLISH_INTERVAL_SEC = int(os.environ.get("PUBLISH_INTERVAL_SEC", "600"))
PRIVATE_KEY = os.environ.get("FORUM_PRIVATE_KEY")
if not PRIVATE_KEY:
    raise SystemExit("FORUM_PRIVATE_KEY env var required")

w3 = Web3(Web3.HTTPProvider("https://rpc.testnet.arc.network"))
account = Account.from_key(PRIVATE_KEY)
client = ForumClient(w3, ARC_TESTNET_DEPLOYMENT, account)


# ----------------------------------------------------------------------------
# REPLACE this with your bot's actual loop.
#
# Return realized + unrealized PnL for the period in micro-USDC (int128),
# plus the list of fills (any structure your bot already uses).
# ----------------------------------------------------------------------------


@dataclass
class PeriodOutput:
    decisions: list[dict]
    fills: list[dict]
    realized_pnl_micros: int
    unrealized_pnl_micros: int


def run_bot(period_start: int, period_end: int) -> PeriodOutput:
    # === your bot's loop here ===
    return PeriodOutput(
        decisions=[{"market": "example", "action": "BUY", "size": 0, "ts": period_end}],
        fills=[],
        realized_pnl_micros=0,
        unrealized_pnl_micros=0,
    )


# ----------------------------------------------------------------------------
# Publish loop — boilerplate.
# ----------------------------------------------------------------------------

bot_id = Web3.keccak(text=f"{account.address.lower()}:{BOT_LABEL}").hex()
print(f"[adapter] signer={account.address} botId={bot_id}")

# Register if needed (MAKER = 0). Idempotent.
tr_v2 = w3.eth.contract(
    address=ARC_TESTNET_DEPLOYMENT.track_record_v2, abi=TRACK_RECORD_V2_ABI
)
try:
    existing_signer = tr_v2.functions.botSigner(bytes.fromhex(bot_id[2:])).call()
    if int(existing_signer, 16) == 0:
        tx = tr_v2.functions.registerBot(
            bytes.fromhex(bot_id[2:]),
            0,
            account.address,
        ).build_transaction(
            {
                "from": account.address,
                "nonce": w3.eth.get_transaction_count(account.address),
            }
        )
        signed = account.sign_transaction(tx)
        h = w3.eth.send_raw_transaction(signed.raw_transaction).hex()
        print(f"[adapter] registered in tx 0x{h}")
        w3.eth.wait_for_transaction_receipt(h)
    else:
        print(f"[adapter] bot already registered, signer={existing_signer}")
except Exception as e:
    print(f"[adapter] register check failed: {e}")


def canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def publish_once(
    seq: int, prev_hash: bytes, period_start: int
) -> tuple[int, bytes, int]:
    period_end = int(time.time())
    out = run_bot(period_start, period_end)

    receipt = {
        "schema": "forum.receipt.v1",
        "botId": bot_id,
        "label": BOT_LABEL,
        "seq": seq,
        "periodStart": period_start,
        "periodEnd": period_end,
        "markets": list({d["market"] for d in out.decisions}),
        "fills": out.fills,
        "pnl": {
            "realizedUsdc": 0,
            "unrealizedUsdc": 0,
            "totalUsdcMicros": out.realized_pnl_micros + out.unrealized_pnl_micros,
            "formulaVersion": "v1",
        },
        "strategy": {"name": BOT_LABEL, "configHash": "0x" + "0" * 64},
        "decisionTrace": {"traceUri": "", "traceHash": "0x" + "0" * 64},
        # Optional Phase 7 cross-chain provenance. If this cycle's capital
        # was bridged in via CCTP V2 (see keeper/scripts/cctp-bridge-and-
        # deposit.mjs), include sourceChain so verifiers can join the
        # receipt graph back to the bridging tx. All three fields are
        # required when present — verifier rejects partial claims.
        # "sourceChain": {
        #     "domain": 6,                                # CCTP V2 domain (0 ETH, 6 Base, 7 Polygon, 26 Arc)
        #     "messageHash": "0x" + "ab" * 32,            # keccak256(messageBytes from Iris)
        #     "txHash":      "0x" + "cd" * 32,            # source-chain depositForBurnWithHook tx
        # },
    }
    receipt_json = canonical_json(receipt)
    evidence_hash = Web3.keccak(text=receipt_json)
    evidence_uri = f"{RECEIPTS_BASE_URL}/{bot_id[2:14]}/{seq:06d}.json"
    print(
        f"[adapter] RECEIPT seq={seq} hash=0x{evidence_hash.hex()} uri={evidence_uri}"
    )

    # TODO: write `receipt_json` to disk + serve at `evidence_uri`
    # For now this is a noop — the on-chain commitment exists, the off-chain JSON
    # must be served from your CDN for third-party verification.

    meta_hash = Web3.keccak(text=f"seq={seq};label={BOT_LABEL}")
    # Build the on-chain Record + sign via EIP-712. See keeper/src/forum-v2.ts
    # for the full reference. Production-grade adapters should use that bridge.
    print("[adapter] (SKIPPED on-chain publish — implement EIP-712 sign + tx send)")
    return seq + 1, evidence_hash, period_end + 1


if __name__ == "__main__":
    seq = 1  # in production read tr_v2.lastSeq(bot_id) + 1
    prev = b"\x00" * 32
    period_start = int(time.time())
    while True:
        seq, prev, period_start = publish_once(seq, prev, period_start)
        time.sleep(PUBLISH_INTERVAL_SEC)
