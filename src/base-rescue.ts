import { BigNumber, Contract, providers, Wallet, utils } from "ethers";
import {
  signRescueBundle,
  submitRescueBundle,
  formatEther,
  formatGwei,
  TokenTransferTx,
} from "./base-utils";

require("log-timestamp");

// ============ CONFIGURATION ============

const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

// Optional: MEV-protected / private RPC endpoint.
// When set, every signed TX is also broadcast here in parallel (fire-and-forget)
// to keep TXs out of the public mempool until block inclusion.
// Recommended providers for Base: dRPC MEV endpoint (premium), Chainstack, 1RPC.
// Example: https://lb.drpc.org/ogrpc?network=base&dkey=YOUR_KEY
const BASE_PRIVATE_RPC_URL = process.env.BASE_PRIVATE_RPC_URL || "";

const PRIVATE_KEY_EXECUTOR = process.env.PRIVATE_KEY_EXECUTOR || "";
const PRIVATE_KEY_SPONSOR = process.env.PRIVATE_KEY_SPONSOR || "";
const RECIPIENT = process.env.RECIPIENT || "";

// Single token or comma-separated list of token addresses to rescue.
// Example: TOKEN_ADDRESSES=0xabc...,0xdef...
const RNBW_ADDRESS = "0xa53887F7e7c1bf5010b8627F1C1ba94fE7a5d6E0";
const TOKEN_ADDRESSES_RAW =
  process.env.TOKEN_ADDRESSES || process.env.TOKEN_ADDRESS || RNBW_ADDRESS;

// Gas settings (Base is EIP-1559; gas is very cheap ~0.001-0.01 gwei normally)
const PRIORITY_FEE_GWEI = parseFloat(process.env.PRIORITY_FEE_GWEI || "0.5");
const MAX_FEE_GWEI = parseFloat(process.env.MAX_FEE_GWEI || "2");

// Minimal ERC-20 ABI
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
];

// ============ VALIDATION ============

function validatePrivateKey(key: string, name: string): string {
  if (!key) {
    console.error(`ERROR: ${name} is required`);
    process.exit(1);
  }
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  if (normalized.length !== 66) {
    console.error(`ERROR: ${name} must be 64 hex characters (32 bytes)`);
    process.exit(1);
  }
  return normalized;
}

function validateEnv(): {
  executorKey: string;
  sponsorKey: string;
  tokenAddresses: string[];
} {
  const executorKey = validatePrivateKey(
    PRIVATE_KEY_EXECUTOR,
    "PRIVATE_KEY_EXECUTOR",
  );
  const sponsorKey = validatePrivateKey(PRIVATE_KEY_SPONSOR, "PRIVATE_KEY_SPONSOR");

  if (!RECIPIENT) {
    console.error("ERROR: RECIPIENT required (safe address to receive tokens)");
    process.exit(1);
  }
  if (!utils.isAddress(RECIPIENT)) {
    console.error("ERROR: RECIPIENT is not a valid Ethereum address");
    process.exit(1);
  }

  const tokenAddresses = TOKEN_ADDRESSES_RAW.split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  for (const addr of tokenAddresses) {
    if (!utils.isAddress(addr)) {
      console.error(`ERROR: Token address is not valid: ${addr}`);
      process.exit(1);
    }
  }

  if (tokenAddresses.length === 0) {
    console.error("ERROR: TOKEN_ADDRESSES must contain at least one valid address");
    process.exit(1);
  }

  return { executorKey, sponsorKey, tokenAddresses };
}

// ============ TOKEN INFO ============

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: BigNumber;
  formattedBalance: string;
  transferData: string;
}

async function fetchTokenInfo(
  provider: providers.JsonRpcProvider,
  tokenAddress: string,
  executorAddress: string,
): Promise<TokenInfo | null> {
  const contract = new Contract(tokenAddress, ERC20_ABI, provider);

  let name: string;
  let symbol: string;
  let decimals: number;
  let balance: BigNumber;

  try {
    [name, symbol, decimals, balance] = await Promise.all([
      contract.name(),
      contract.symbol(),
      contract.decimals(),
      contract.balanceOf(executorAddress),
    ]);
  } catch (e: any) {
    console.warn(`WARNING: Failed to read token at ${tokenAddress}: ${e.message}`);
    return null;
  }

  if (balance.isZero()) {
    console.log(`Skipping ${symbol || tokenAddress}: zero balance on executor.`);
    return null;
  }

  const formattedBalance = utils.formatUnits(balance, decimals);
  const transferData = contract.interface.encodeFunctionData("transfer", [
    RECIPIENT,
    balance,
  ]);

  return { address: tokenAddress, name, symbol, decimals, balance, formattedBalance, transferData };
}

// ============ MAIN RESCUE FLOW ============

async function main() {
  const { executorKey, sponsorKey, tokenAddresses } = validateEnv();

  console.log("========================================");
  console.log("  BASE CHAIN TOKEN RESCUE");
  console.log("  Strategy: Rapid Burst + Gas Escalation");
  console.log("========================================\n");

  const provider = new providers.JsonRpcProvider(BASE_RPC_URL);
  const network = await provider.getNetwork();
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);

  if (network.chainId !== 8453 && network.chainId !== 84532) {
    console.warn(
      `WARNING: Expected Base (8453) or Base Sepolia (84532), got chainId ${network.chainId}`,
    );
  }

  // Build private provider list for parallel broadcast
  const privateProviders: providers.JsonRpcProvider[] = [];
  if (BASE_PRIVATE_RPC_URL) {
    try {
      const privateProvider = new providers.JsonRpcProvider(BASE_PRIVATE_RPC_URL);
      privateProviders.push(privateProvider);
      console.log(`Private RPC: ${BASE_PRIVATE_RPC_URL}`);
      console.log("  TXs will be broadcast to public + private endpoint simultaneously.");
    } catch (e: any) {
      console.warn(`WARNING: Failed to initialize private RPC provider: ${e.message}`);
    }
  } else {
    console.log("Private RPC: none (set BASE_PRIVATE_RPC_URL for MEV-protected submission)");
  }

  const walletExecutor = new Wallet(executorKey, provider);
  const walletSponsor = new Wallet(sponsorKey, provider);

  console.log(`\nExecutor (compromised): ${walletExecutor.address}`);
  console.log(`Sponsor (pays gas):     ${walletSponsor.address}`);
  console.log(`Recipient (safe):       ${RECIPIENT}`);
  console.log(`Tokens:                 ${tokenAddresses.join(", ")}\n`);

  // Check for EIP-7702 delegation on executor
  const executorCode = await provider.getCode(walletExecutor.address);
  const executorIsContract = executorCode !== "0x" && executorCode.length > 2;
  if (executorIsContract) {
    console.warn("========================================");
    console.warn("  WARNING: EIP-7702 DELEGATION DETECTED");
    console.warn("========================================");
    console.warn(`The compromised wallet has contract code (${executorCode.length} bytes).`);
    console.warn("This may be an EIP-7702 delegation used by the sweeper bot.");
    console.warn("The delegation could intercept incoming ETH via receive().");
    console.warn("Proceeding anyway - if funding TX fails, revoke the delegation first.\n");
  }

  // Fetch token info for all requested addresses
  console.log("--- FETCHING TOKEN BALANCES ---");
  const tokenInfos: TokenInfo[] = [];
  for (const addr of tokenAddresses) {
    const info = await fetchTokenInfo(provider, addr, walletExecutor.address);
    if (info) {
      console.log(`Found: ${info.formattedBalance} ${info.symbol} (${info.name}) @ ${info.address}`);
      tokenInfos.push(info);
    }
  }

  if (tokenInfos.length === 0) {
    console.error("\nERROR: No tokens with non-zero balance found. Aborting.");
    process.exit(1);
  }

  // Check sponsor ETH balance
  const sponsorBalance = await provider.getBalance(walletSponsor.address);
  console.log(`\nSponsor ETH: ${formatEther(sponsorBalance)} ETH`);

  // Estimate gas for each token transfer
  console.log("\n--- ESTIMATING GAS ---");
  const tokenTransferTxs: TokenTransferTx[] = [];
  for (const info of tokenInfos) {
    let gasEstimate: BigNumber;
    try {
      gasEstimate = await provider.estimateGas({
        from: walletExecutor.address,
        to: info.address,
        data: info.transferData,
      });
      gasEstimate = gasEstimate.mul(120).div(100); // +20% buffer
    } catch (e: any) {
      console.warn(
        `Gas estimation failed for ${info.symbol} (expected if executor has no ETH): ${e.message}`,
      );
      gasEstimate = BigNumber.from(65000);
      console.log(`Using default gas limit for ${info.symbol}: ${gasEstimate.toString()}`);
    }
    console.log(`Gas estimate for ${info.symbol}: ${gasEstimate.toString()}`);
    tokenTransferTxs.push({ to: info.address, data: info.transferData, gasLimit: gasEstimate });
  }

  // Pre-sign all transactions in one atomic batch
  console.log("\n--- PRE-SIGNING TRANSACTIONS ---");
  const bundle = await signRescueBundle(
    provider,
    walletSponsor,
    walletExecutor,
    tokenTransferTxs,
    PRIORITY_FEE_GWEI,
    MAX_FEE_GWEI,
    executorIsContract,
  );

  console.log(`Executor nonce: ${bundle.executorNonce}`);
  console.log(`Sponsor nonce:  ${bundle.sponsorNonce}`);
  console.log(`Gas price:      ${formatGwei(bundle.gasPrice)} gwei`);
  console.log(`Total gas cost: ${formatEther(bundle.totalGasCost)} ETH`);

  // Verify sponsor can cover all costs
  const fundingGasLimit = executorIsContract ? 100000 : 21000;
  const fundingTxGas = BigNumber.from(fundingGasLimit).mul(bundle.gasPrice);
  const totalRequired = bundle.totalGasCost.add(fundingTxGas);

  if (sponsorBalance.lt(totalRequired)) {
    console.error(
      `\nERROR: Sponsor has insufficient ETH.\n` +
        `  Need:  ${formatEther(totalRequired)} ETH\n` +
        `    (${formatEther(bundle.totalGasCost)} executor gas + ${formatEther(fundingTxGas)} funding TX gas)\n` +
        `  Have:  ${formatEther(sponsorBalance)} ETH`,
    );
    process.exit(1);
  }

  // Gas safety warning if fees seem unusually high for Base
  const gasPriceGwei = parseFloat(utils.formatUnits(bundle.gasPrice, "gwei"));
  if (gasPriceGwei > 5) {
    console.warn(
      `\nWARNING: Gas price is ${gasPriceGwei.toFixed(3)} gwei — higher than normal for Base.`,
    );
    console.warn(`  Total cost: ${formatEther(totalRequired)} ETH. Verify this is acceptable.\n`);
  }

  // Summary
  console.log("\n========================================");
  console.log("  RESCUE SUMMARY");
  console.log("========================================");
  for (const info of tokenInfos) {
    console.log(`Token:    ${info.formattedBalance} ${info.symbol}`);
  }
  console.log(`Gas cost: ${formatEther(bundle.totalGasCost)} ETH`);
  console.log(
    `TX count: 1 funding + ${tokenTransferTxs.length} transfer(s) = ${1 + tokenTransferTxs.length} total`,
  );
  if (privateProviders.length > 0) {
    console.log(`Private:  ${privateProviders.length} MEV-protected endpoint(s) in parallel`);
  }
  console.log(`Retries:  up to 3 attempts, 1.3x gas escalation per retry`);
  console.log("========================================\n");

  // Execute the rescue
  console.log(">>> EXECUTING RESCUE <<<\n");

  try {
    const result = await submitRescueBundle(
      provider,
      bundle,
      walletExecutor,
      walletSponsor,
      tokenTransferTxs,
      PRIORITY_FEE_GWEI,
      executorIsContract,
      privateProviders,
    );

    console.log("\n========================================");
    if (result.success) {
      console.log("  RESCUE SUCCESSFUL!");
      for (const info of tokenInfos) {
        console.log(`  ${info.formattedBalance} ${info.symbol} transferred to ${RECIPIENT}`);
      }
      console.log(`  Completed in ${result.attempts} attempt(s).`);
    } else {
      console.log("  RESCUE FAILED");
      if (result.error) console.log(`  Reason: ${result.error}`);
      console.log("  The sweeper may have drained gas before the transfer executed.");
      console.log("  Try again with higher MAX_FEE_GWEI or add BASE_PRIVATE_RPC_URL.");
    }
    console.log("========================================");
    if (result.fundingHash) {
      console.log(`Funding TX:  https://basescan.org/tx/${result.fundingHash}`);
    }
    result.transferHashes.forEach((hash, i) => {
      const label = tokenInfos[i] ? `${tokenInfos[i].symbol} TX:` : `Transfer #${i}:`;
      console.log(`${label.padEnd(14)} https://basescan.org/tx/${hash}`);
    });
  } catch (e: any) {
    console.error(`\nRESCUE ERROR: ${e.message}`);
    if (e.message.includes("insufficient funds")) {
      console.error("\nThe sweeper likely drained ETH before the transfer executed.");
      console.error("Try again with a higher MAX_FEE_GWEI or BASE_PRIVATE_RPC_URL.");
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
