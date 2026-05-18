# forum-arc-sdk

TypeScript SDK for Forum on Arc.

It wraps the original operator-plane contracts plus the Covenant Account surface:
`TrackRecordV2`, `CovenantVault`, `RiskKernelV2`, `SlashBond`, and `AgentPool`.

## Install

```bash
npm i forum-arc-sdk
```

## Read the live Covenant Account

```typescript
import { createPublicClient, http } from "viem";
import { ARC_TESTNET, ForumClient } from "forum-arc-sdk";
import { ARC_TESTNET_DEPLOYMENT } from "forum-arc-sdk/deployments";

const publicClient = createPublicClient({
  chain: {
    id: ARC_TESTNET.chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [ARC_TESTNET.rpc] } },
  },
  transport: http(),
});

const forum = new ForumClient({
  publicClient,
  addresses: ARC_TESTNET_DEPLOYMENT,
});

const vault = await forum.covenantVault.snapshot();
const verdict = await forum.riskKernel.evaluate();
const bond = await forum.slashBond.bondBalance();
```

Write calls require a Viem `walletClient` with an account.
