import { BigNumber, Contract, providers, Wallet, utils } from "ethers";
import {
  TokenTransferTx,
  signRescueBundle,
  submitRescueBundle,
  formatEther,
  formatGwei,
} from "./base-utils";

require("log-timestamp");

// ============ CONFIGURATION ============

const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

/**
 * PRIVATE RPC STRATEGY
 *
 * Submitting through a private/protected RPC reduces the chance that
 * sweeper bots watching the public mempool can front-run your transfer.
 *
 * Options for Base chain (in preference order):
 *   1. dRPC MEV protection (paid): https://base.drpc.org  (set BASE_RPC_URL)
 *   2. Alchemy private endpoint:   https://base-mainnet.g.alchemy.com/v2/<KEY>
 *   3. Coinbase CDP node:          https://api.developer.coinbase.com/rpc/v1/base/<KEY>
 *   4. Public fallback:            https://mainnet.base.org
 *
 * Set BASE_RPC_URL in your .env to whichever private endpoint you have access to.
 * The rescue logic is identical regardless of which RPC you use — the difference
 * is only whether your transactions are visible in the public mempool before inclusion.
 *
 * Note: Unlike Flashbots on mainnet, Base has no native atomic bundle guarantee.
 * The rapid-burst strategy (sign all → submit funding → immediately blast transfers)
 * combined with aggressive priority fees is the closest equivalent available.
 */

const PRIVATE_KEY_EXECUTOR = process.env.PRIVATE_KEY_EXECUTOR || "";
const PRIVATE_KEY_SPONSOR = process.env.PRIVATE_KEY_SPONSOR || "";
const RECIPIENT = process.env.RECIPIENT || "";

// Target tokens to rescue — comma-separated for multi-token rescue
const RNBW_ADDRESS = "0xa53887F7e7c1bf5010b8627F1C1ba94fE7a5d6E0";
const TOKEN_ADDRESSES_RAW =
  process.env.TOKEN_ADDRESSES ||
  process.env.TOKEN_ADDRESS ||
  RNBW_ADDRESS;
const TOKEN_ADDRESSES = TOKEN_ADDRESSES_RAW.split(",").map((a) => a.trim()).filter(Boolean);

// Gas settings (Base gas is very cheap)
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

function validateEnv(): void {
  validatePrivateKey(PRIVATE_KEY_EXECUTOR, "PRIVATE_KEY_EXECUTOR");
  validatePrivateKey(PRIVATE_KEY_SPONSOR, "PRIVATE_KEY_SPONSOR");
  if (!RECIPIENT) {
    console.error("ERROR: RECIPIENT required (safe address to receive tokens)");
    process.exit(1);
  }
  if (!utils.isAddress(RECIPIENT)) {
    console.error("ERROR: RECIPIENT is not a valid address");
    process.exit(1);
  }
}

// ============ TOKEN INFO ============

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: BigNumber;
  transferData: string;
}

async function getTokenInfo(
  provider: providers.JsonRpcProvider,
  tokenAddress: string,
  executorAddress: string,
): Promise<TokenInfo | null> {
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
  let name: string, symbol: string, decimals: number, balance: BigNumber;

  try {
    [name, symbol, decimals, balance] = await Promise.all([
      tokenContract.name(),
      tokenContract.symbol(),
      tokenContract.decimals(),
      tokenContract.balanceOf(executorAddress),
    ]);
  } catch (e: any) {
    console.error(`Failed to read token ${tokenAddress}: ${e.message}`);
    return null;
  }

  if (balance.isZero()) {
    console.log(`  No balance: ${symbol} (${tokenAddress})`);
    return null;
  }

  const transferData = tokenContract.interface.encodeFunctionData("transfer", [
    RECIPIENT,
    balance,
  ]);

  return { address: tokenAddress, name, symbol, decimals, balance, transferData };
}

// ============ MAIN RESCUE FLOW ============

async function main() {
  validateEnv();

  console.log("========================================");
  console.log("  BASE CHAIN TOKEN RESCUE");
  console.log("  Strategy: Rapid Burst + Retry with Gas Escalation");
  console.log("========================================\n");

  // Warn if using public RPC — private is strongly preferred
  if (
    BASE_RPC_URL === "https://mainnet.base.org" ||
    BASE_RPC_URL.includes("publicnode") ||
    BASE_RPC_URL.includes("ankr.com/rpc/base")
  ) {
    console.warn("========================================");
    console.warn("  WARNING: PUBLIC RPC DETECTED");
    console.warn("========================================");
    console.warn("Your transactions will be visible in the public mempool.");
    console.warn("Sweeper bots can front-run your transfer.");
    console.warn(
      "Set BASE_RPC_URL to a private endpoint (Alchemy, dRPC, Coinbase CDP) for better protection.\n",
    );
  }

  // Connect to Base
  const provider = new providers.JsonRpcProvider(BASE_RPC_URL);
  const network = await provider.getNetwork();
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`RPC: ${BASE_RPC_URL}`);

  if (network.chainId !== 8453 && network.chainId !== 84532) {
    console.warn(
      `WARNING: Expected Base (8453) or Base Sepolia (84532), got chainId ${network.chainId}`,
    );
  }

  // Initialize wallets
  const walletExecutor = new Wallet(PRIVATE_KEY_EXECUTOR, provider);
  const walletSponsor = new Wallet(PRIVATE_KEY_SPONSOR, provider);

  console.log(`\nExecutor (compromised): ${walletExecutor.address}`);
  console.log(`Sponsor (pays gas):     ${walletSponsor.address}`);
  console.log(`Recipient (safe):       ${RECIPIENT}`);
  console.log(`Tokens:                 ${TOKEN_ADDRESSES.join(", ")}\n`);

  // Check gas settings vs current baseFee
  const block = await provider.getBlock("latest");
  const baseFee = block.baseFeePerGas || BigNumber.from(0);
  const baseFeeGwei = parseFloat(utils.formatUnits(baseFee, "gwei"));
  if (MAX_FEE_GWEI < baseFeeGwei * 1.5) {
    console.warn(
      `WARNING: MAX_FEE_GWEI (${MAX_FEE_GWEI}) is below 1.5x current baseFee (${(baseFeeGwei * 1.5).toFixed(4)} gwei). ` +
        `Consider increasing MAX_FEE_GWEI for faster inclusion.\n`,
    );
  }

  // Check for EIP-7702 delegation
  const executorCode = await provider.getCode(walletExecutor.address);
  const executorIsContract = executorCode !== "0x" && executorCode.length > 2;
  if (executorIsContract) {
    console.warn("========================================");
    console.warn("  WARNING: EIP-7702 DELEGATION DETECTED");
    console.warn("========================================");
    console.warn(
      `The compromised wallet has contract code (${executorCode.length} bytes).`,
    );
    console.warn("This may be an EIP-7702 delegation used by the sweeper bot.");
    console.warn("The delegation could intercept incoming ETH via receive().");
    console.warn(
      "Proceeding anyway - if funding TX fails, the delegation must be revoked first.\n",
    );
  }

  // Fetch token info for all addresses
  console.log("--- SCANNING TOKENS ---");
  const tokenInfoResults = await Promise.all(
    TOKEN_ADDRESSES.map((addr) =>
      getTokenInfo(provider, addr, walletExecutor.address),
    ),
  );
  const tokens = tokenInfoResults.filter((t): t is TokenInfo => t !== null);

  if (tokens.length === 0) {
    console.error(
      `No token balances found for ${walletExecutor.address} across all specified tokens.`,
    );
    process.exit(1);
  }

  console.log(`\nFound ${tokens.length} token(s) to rescue:`);
  tokens.forEach((t) => {
    const formatted = utils.formatUnits(t.balance, t.decimals);
    console.log(`  ${formatted} ${t.symbol} (${t.address})`);
  });

  // Check sponsor ETH balance
  const sponsorBalance = await provider.getBalance(walletSponsor.address);
  console.log(`\nSponsor ETH: ${formatEther(sponsorBalance)} ETH`);

  // Build transfer calldata for each token and estimate gas
  console.log("\n--- ESTIMATING GAS ---");
  const tokenTransferTxs: TokenTransferTx[] = [];

  for (const token of tokens) {
    let gasEstimate: BigNumber;
    try {
      gasEstimate = await provider.estimateGas({
        from: walletExecutor.address,
        to: token.address,
        data: token.transferData,
      });
      gasEstimate = gasEstimate.mul(120).div(100); // 20% buffer
    } catch (e: any) {
      console.warn(
        `Gas estimation failed for ${token.symbol} (expected if executor has no ETH): ${e.message}`,
      );
      gasEstimate = BigNumber.from(65000);
      console.log(`  Using default gas limit for ${token.symbol}: 65000`);
    }
    console.log(`  ${token.symbol}: ${gasEstimate.toString()} gas`);
    tokenTransferTxs.push({
      to: token.address,
      data: token.transferData,
      gasLimit: gasEstimate,
    });
  }

  // Pre-sign all transactions
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

  console.log(`Total gas cost: ${formatEther(bundle.totalGasCost)} ETH`);
  console.log(`Max fee: ${formatGwei(bundle.gasPrice)} gwei`);

  // Account for both executor gas cost AND the funding TX's own gas
  const fundingTxGas = BigNumber.from(executorIsContract ? 100000 : 21000).mul(bundle.gasPrice);
  const totalRequired = bundle.totalGasCost.add(fundingTxGas);

  if (sponsorBalance.lt(totalRequired)) {
    console.error(
      `\nERROR: Sponsor has insufficient ETH.`,
    );
    console.error(
      `  Need:  ${formatEther(totalRequired)} ETH (${formatEther(bundle.totalGasCost)} executor gas + ${formatEther(fundingTxGas)} funding TX gas)`,
    );
    console.error(`  Have:  ${formatEther(sponsorBalance)} ETH`);
    process.exit(1);
  }

  // Summary before execution
  console.log("\n========================================");
  console.log("  RESCUE SUMMARY");
  console.log("========================================");
  tokens.forEach((t) => {
    console.log(`  ${utils.formatUnits(t.balance, t.decimals)} ${t.symbol}`);
  });
  console.log(`Gas cost:     ${formatEther(bundle.totalGasCost)} ETH`);
  console.log(`Max fee:      ${formatGwei(bundle.gasPrice)} gwei`);
  console.log(`TX Count:     1 funding + ${tokens.length} transfer(s) = ${1 + tokens.length} total`);
  console.log(`Strategy:     Submit funding → blast transfer(s) → retry with gas escalation if needed`);
  console.log(`Retries:      Up to 3 attempts (1x → 1.3x → 1.69x gas)`);
  console.log("========================================\n");

  // Execute the rescue
  console.log(">>> EXECUTING RESCUE <<<\n");

  const result = await submitRescueBundle(
    provider,
    bundle,
    walletExecutor,
    walletSponsor,
    tokenTransferTxs,
    PRIORITY_FEE_GWEI,
    executorIsContract,
  );

  console.log("\n========================================");
  if (result.success) {
    console.log("  RESCUE SUCCESSFUL!");
    tokens.forEach((t) => {
      console.log(
        `  ${utils.formatUnits(t.balance, t.decimals)} ${t.symbol} → ${RECIPIENT}`,
      );
    });
    console.log(`  Completed in ${result.attempts} attempt(s)`);
  } else {
    console.log("  RESCUE FAILED");
    console.log(`  Attempted ${result.attempts} time(s)`);
    console.log(
      "  The sweeper may have drained the gas before the transfer executed.",
    );
    if (result.error) {
      console.log(`  Last error: ${result.error}`);
    }
    console.log(
      "  Consider: higher MAX_FEE_GWEI, a private RPC endpoint, or re-running immediately.",
    );
    console.log("  Check the transaction hashes below for details.");
  }
  console.log("========================================");

  if (result.fundingHash) {
    console.log(`\nFunding TX:  ${result.fundingHash}`);
  }
  result.transferHashes.forEach((hash, i) => {
    console.log(`Transfer #${i}: ${hash}`);
  });

  if (result.transferHashes.length > 0) {
    console.log(
      `\nView on Basescan: https://basescan.org/tx/${result.transferHashes[0]}`,
    );
  }

  if (!result.success) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
