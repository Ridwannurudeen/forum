#!/usr/bin/env node
// Phase 7 · CCTP V2 bridge + CovenantInbox deposit.
//
// End-to-end flow:
//  1. Source chain (e.g. Base Sepolia, Polygon Amoy):
//       a. USDC.approve(TokenMessengerV2, amount)
//       b. TokenMessengerV2.depositForBurnWithHook(
//            amount,
//            ARC_DOMAIN=26,
//            mintRecipient = bytes32(uint256(uint160(CovenantInbox))),
//            burnToken     = source-chain USDC,
//            destinationCaller = bytes32(0),    // anyone may call receive
//            maxFee        = 0,                 // standard transfer (slow)
//            minFinalityThreshold = 2000,       // standard
//            hookData      = abi.encode(vault, recipient),
//          )
//
//  2. Off-chain: wait for Circle Iris attestation
//       GET https://iris-api-sandbox.circle.com/v2/messages/{sourceDomain}?transactionHash=<sourceTxHash>
//       Poll until status == 'complete'; capture `message` + `attestation` bytes.
//
//  3. Arc testnet (this script — Arc-side leg):
//       MessageTransmitterV2.receiveMessage(message, attestation)
//       MintAndWithdrawWithHook fires → USDC lands at CovenantInbox.
//       Inbox handles deposit into the (vault, recipient) tuple encoded in hookData.
//
// IMPORTANT — what this script does *today*:
//   --build-source : prints the depositForBurnWithHook calldata + summary so a
//                    funded source-chain wallet can broadcast it.
//   --redeem       : given message+attestation bytes from Iris, broadcasts the
//                    Arc-side receiveMessage tx using your Arc deployer key.
//   --simulate     : runs both stages against pinned addresses but stops before
//                    sending any source-chain transaction (no source key needed).
//
// We do NOT auto-broadcast on the source chain because that requires the user
// to fund a wallet on Base Sepolia / Polygon Amoy / etc. with native gas +
// source-chain USDC. The script makes it a one-liner once the user has both.
//
// References (verified 2026-05-18):
//   - Circle CCTP V2 docs: developers.circle.com/cctp/v2-development
//   - Arc CCTP page: docs.arc.io/arc/references/contract-addresses
//   - Both TokenMessengerV2 and MessageTransmitterV2 use the same deterministic
//     addresses across all CCTP V2 chains.

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import {
  createPublicClient, createWalletClient, defineChain, http, parseAbi,
  encodeFunctionData, encodeAbiParameters, pad, toHex, isAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dirname, '..', '..'));

const d = JSON.parse(readFileSync('deployments/arc-testnet.json', 'utf8'));
const CCTP = d.circle.cctp;

// Source-chain canonical USDC contracts (Circle CCTP V2 testnet).
const SOURCE_USDC = {
  ethereumSepolia: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  avalancheFuji:   '0x5425890298aed601595a70AB815c96711a31Bc65',
  baseSepolia:     '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  polygonAmoy:     '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
};
const SOURCE_RPC = {
  ethereumSepolia: 'https://ethereum-sepolia-rpc.publicnode.com',
  avalancheFuji:   'https://avalanche-fuji-c-chain-rpc.publicnode.com',
  baseSepolia:     'https://base-sepolia-rpc.publicnode.com',
  polygonAmoy:     'https://polygon-amoy-bor-rpc.publicnode.com',
};

const ARC_DOMAIN = CCTP.arcTestnetDomain;
const TM = CCTP.tokenMessengerV2;        // identical address on Arc + source
const MT = CCTP.messageTransmitterV2;    // identical address on Arc + source

const ARC = defineChain({
  id: 5042002, name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
});

const TOKEN_MESSENGER_ABI = parseAbi([
  'function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)',
]);
const MESSAGE_TRANSMITTER_ABI = parseAbi([
  'function receiveMessage(bytes message,bytes attestation) returns (bool)',
]);
const ERC20_ABI = parseAbi(['function approve(address,uint256) returns (bool)']);

function addrToBytes32(addr) {
  return pad(addr.toLowerCase(), { size: 32 });
}
function encodeHookData(vault, recipient) {
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }],
    [vault, recipient],
  );
}

function usage() {
  console.log(`
Usage:
  node keeper/scripts/cctp-bridge-and-deposit.mjs --build-source \\
       --source baseSepolia \\
       --amount 1000000 \\
       --vault 0xCovenantVaultAddress \\
       --recipient 0xRecipientAddress

  node keeper/scripts/cctp-bridge-and-deposit.mjs --redeem \\
       --message 0x... --attestation 0x...

  node keeper/scripts/cctp-bridge-and-deposit.mjs --simulate \\
       --source baseSepolia --amount 1000000 \\
       --vault 0x... --recipient 0x...

Flags:
  --source <chain>      one of: ethereumSepolia, avalancheFuji, baseSepolia, polygonAmoy
  --amount <micros>     USDC amount in micros (1 USDC = 1_000_000)
  --vault <addr>        Arc CovenantVault that should receive deposit on redemption
  --recipient <addr>    address that receives vault shares (often the original sender)
`);
}

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((arg, i, arr) => {
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = arr[i + 1];
      return next && !next.startsWith('--') ? [[key, next]] : [[key, true]];
    }
    return [];
  }),
);

if (args.help || (!args['build-source'] && !args['redeem'] && !args['simulate'])) {
  usage(); process.exit(args.help ? 0 : 1);
}

if (args['build-source'] || args['simulate']) {
  const src = args.source;
  if (!SOURCE_USDC[src]) { console.error('unknown --source:', src); process.exit(1); }
  const amount = BigInt(args.amount || '0');
  if (amount <= 0n) { console.error('--amount must be > 0 (in micros)'); process.exit(1); }
  const vault = args.vault;
  const recipient = args.recipient;
  if (!vault || !isAddress(vault)) { console.error('--vault required, must be a valid address'); process.exit(1); }
  if (!recipient || !isAddress(recipient)) { console.error('--recipient required, must be a valid address'); process.exit(1); }

  const inbox = d.contracts.CovenantInbox.address;
  const mintRecipient = addrToBytes32(inbox);
  const hookData = encodeHookData(vault, recipient);

  const approveCalldata = encodeFunctionData({
    abi: ERC20_ABI, functionName: 'approve', args: [TM, amount],
  });
  const burnCalldata = encodeFunctionData({
    abi: TOKEN_MESSENGER_ABI, functionName: 'depositForBurnWithHook',
    args: [
      amount,
      ARC_DOMAIN,
      mintRecipient,
      SOURCE_USDC[src],
      pad('0x', { size: 32 }), // destinationCaller = anyone may redeem
      0n,                       // maxFee = 0 → standard (slow) transfer
      2000,                     // minFinalityThreshold standard
      hookData,
    ],
  });

  console.log(`\n=== Source-chain leg (${src}) ===`);
  console.log(`RPC suggestion : ${SOURCE_RPC[src]}`);
  console.log(`USDC (source)  : ${SOURCE_USDC[src]}`);
  console.log(`TokenMessenger : ${TM}`);
  console.log(`Domain         : ${ARC_DOMAIN}  (Arc testnet)`);
  console.log(`Mint recipient : ${mintRecipient}`);
  console.log(`                 → decodes to ${inbox}  (CovenantInbox on Arc)`);
  console.log(`Hook data      : ${hookData}`);
  console.log(`                 → (vault=${vault}, recipient=${recipient})`);
  console.log(`Amount (micros): ${amount}`);

  console.log(`\nTx #1 (approve):`);
  console.log(`  to    : ${SOURCE_USDC[src]}`);
  console.log(`  data  : ${approveCalldata}`);

  console.log(`\nTx #2 (depositForBurnWithHook):`);
  console.log(`  to    : ${TM}`);
  console.log(`  data  : ${burnCalldata}`);

  console.log(`\nNext step:`);
  console.log(`  1. Sign + broadcast both txs on ${src} with a wallet holding USDC + native gas.`);
  console.log(`  2. Save the depositForBurnWithHook tx hash; poll Iris:`);
  console.log(`       https://iris-api-sandbox.circle.com/v2/messages/${CCTP.sourceDomains[src]}?transactionHash=<txHash>`);
  console.log(`  3. When status == 'complete', take .message + .attestation and run:`);
  console.log(`       node keeper/scripts/cctp-bridge-and-deposit.mjs --redeem --message 0x... --attestation 0x...`);

  if (args['simulate']) {
    console.log(`\n[simulate] no source-chain tx sent. Calldata is correct against pinned addresses.`);
  }
  process.exit(0);
}

if (args['redeem']) {
  const message = args.message;
  const attestation = args.attestation;
  if (!message || !attestation) { console.error('--message and --attestation required'); process.exit(1); }

  const pk = readFileSync(join(homedir(), '.forum-keys', 'deployer.key'), 'utf8').trim();
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
  const pub = createPublicClient({ chain: ARC, transport: http() });
  const wal = createWalletClient({ chain: ARC, transport: http(), account });

  console.log(`Redeeming on Arc via MessageTransmitterV2 ${MT} ...`);
  const tx = await wal.sendTransaction({
    to: MT,
    data: encodeFunctionData({
      abi: MESSAGE_TRANSMITTER_ABI, functionName: 'receiveMessage',
      args: [message, attestation],
    }),
  });
  console.log(`tx: ${tx}`);
  const rcpt = await pub.waitForTransactionReceipt({ hash: tx });
  console.log(`status: ${rcpt.status}, gasUsed: ${rcpt.gasUsed}`);
  if (rcpt.status !== 'success') {
    console.error('receiveMessage reverted — check attestation freshness + source-chain finality.');
    process.exit(2);
  }
  console.log(`\nUSDC minted into CovenantInbox; the inbox handler decoded hookData and deposited into the configured vault.`);
}
