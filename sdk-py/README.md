# forum-arc

Python SDK for Forum on Arc.

It wraps the original operator-plane contracts plus the Covenant Account surface:
`TrackRecordV2`, `CovenantVault`, `RiskKernelV2`, `SlashBond`, and `AgentPool`.

## Install

```bash
pip install forum-arc
```

## Read the live Covenant Account

```python
from web3 import Web3

from forum_arc import ARC_TESTNET, ForumClient
from forum_arc.deployments import ARC_TESTNET_DEPLOYMENT

w3 = Web3(Web3.HTTPProvider(ARC_TESTNET["rpc"]))
forum = ForumClient(w3, ARC_TESTNET_DEPLOYMENT)

vault = forum.covenant_vault.snapshot()
verdict = forum.risk_kernel.evaluate(ARC_TESTNET_DEPLOYMENT.covenant_vault)
bond = forum.slash_bond.bond_balance()
```

Write calls require an `eth_account` account.
