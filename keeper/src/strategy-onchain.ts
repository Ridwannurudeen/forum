// On-chain recomputation for CovenantVaultV2 strategy legs. Lets a verifier
// independently confirm a receipt's claimed yield by reading the
// RecalledFromStrategy events from the recall transaction(s), rather than
// trusting the receipt's declared numbers.

import {
  decodeEventLog,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

export const RECALLED_FROM_STRATEGY_EVENT = [
  {
    type: "event",
    name: "RecalledFromStrategy",
    inputs: [
      { name: "adapter", type: "address", indexed: true },
      { name: "principal", type: "uint256", indexed: false },
      { name: "recovered", type: "uint256", indexed: false },
    ],
  },
] as const;

export interface OnChainRecall {
  adapter: Address;
  principalMicros: bigint;
  recoveredMicros: bigint;
}

/** Decode every RecalledFromStrategy event from a set of logs. Pure — logs in,
 *  decoded recalls out; non-matching logs are skipped. */
export function decodeRecalls(
  logs: readonly { topics: readonly Hex[]; data: Hex }[],
): OnChainRecall[] {
  const out: OnChainRecall[] = [];
  for (const log of logs) {
    try {
      const ev = decodeEventLog({
        abi: RECALLED_FROM_STRATEGY_EVENT,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
      if (ev.eventName === "RecalledFromStrategy") {
        const args = ev.args as unknown as {
          adapter: Address;
          principal: bigint;
          recovered: bigint;
        };
        out.push({
          adapter: args.adapter,
          principalMicros: args.principal,
          recoveredMicros: args.recovered,
        });
      }
    } catch {
      // not a RecalledFromStrategy log — ignore
    }
  }
  return out;
}

export interface RecallPnl {
  adapter: Address;
  principalMicros: bigint;
  recoveredMicros: bigint;
  realizedMicros: bigint;
}

/** Fetch a recall tx and recompute its realized yield (recovered - principal)
 *  by summing the RecalledFromStrategy events it emitted. Returns null if the
 *  tx emitted no such event. */
export async function recomputeRecallPnl(
  client: PublicClient,
  recallTx: Hex,
): Promise<RecallPnl | null> {
  const rcpt = await client.getTransactionReceipt({ hash: recallTx });
  const recalls = decodeRecalls(rcpt.logs);
  if (recalls.length === 0) return null;
  let principal = 0n;
  let recovered = 0n;
  for (const r of recalls) {
    principal += r.principalMicros;
    recovered += r.recoveredMicros;
  }
  return {
    adapter: recalls[0]!.adapter,
    principalMicros: principal,
    recoveredMicros: recovered,
    realizedMicros: recovered - principal,
  };
}
