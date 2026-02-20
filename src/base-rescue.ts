import { BigNumber, Contract, providers, Wallet, utils } from "ethers";
import {
  signRescueBundle,
  submitRescueBundle,
  formatEther,
  formatGwei,
} from "./base-utils";

require("log-timestamp");

// ============ CONFIGURATION ============

const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const PRIVATE_KEY_EXECUTOR = process.env.PRIVATE_KEY_EXECUTOR || "";
const PRIVATE_KEY_SPONSOR = process.env.PRIVATE_KEY_SPONSOR || "";
const RECIPIENT = process.env.RECIPIENT || "";

// Target token to rescue
const RNBW_ADDRESS = "0xa53887F7e7c1bf5010b8627F1C1ba94fE7a5d6E0";
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || RNBW_ADDRESS;

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

// ============ MAIN RESCUE FLOW ============

async function main() {
  validateEnv();

  console.log("========================================");
  console.log("  BASE CHAIN TOKEN RESCUE");
  console.log("  Strategy: Rapid Burst Submission");
  console.log("========================================\n");

  // Connect to Base
  const provider = new providers.JsonRpcProvider(BASE_RPC_URL);
  const network = await provider.getNetwork();
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);

  if (network.chainId !== 8453 && network.chainId !== 84532) {
    console.warn(
      `WARNING: Expected Base (8453) or Base Sepolia (84532), got chainId ${network.chainId}`,
    );
  }

  // Initialize wallets
  const walletExecutor = new Wallet(PRIVATE_KEY_EXECUTOR, provider);
  const walletSponsor = new Wallet(PRIVATE_KEY_SPONSOR, provider);

  console.log(`Executor (compromised): ${walletExecutor.address}`);
  console.log(`Sponsor (pays gas):     ${walletSponsor.address}`);
  console.log(`Recipient (safe):       ${RECIPIENT}`);
  console.log(`Token:                  ${TOKEN_ADDRESS}\n`);

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

  // Get token info and balance
  const tokenContract = new Contract(TOKEN_ADDRESS, ERC20_ABI, provider);

  let tokenSymbol: string;
  let tokenDecimals: number;
  let tokenBalance: BigNumber;
  let tokenName: string;

  try {
    [tokenName, tokenSymbol, tokenDecimals, tokenBalance] = await Promise.all([
      tokenContract.name(),
      tokenContract.symbol(),
      tokenContract.decimals(),
      tokenContract.balanceOf(walletExecutor.address),
    ]);
  } catch (e: any) {
    console.error(`Failed to read token contract: ${e.message}`);
    process.exit(1);
  }

  if (tokenBalance.isZero()) {
    console.error(
      `No ${tokenSymbol} balance found for ${walletExecutor.address}`,
    );
    process.exit(1);
  }

  const formattedBalance = utils.formatUnits(tokenBalance, tokenDecimals);
  console.log(`Token: ${tokenName} (${tokenSymbol})`);
  console.log(`Balance: ${formattedBalance} ${tokenSymbol}`);

  // Check sponsor ETH balance
  const sponsorBalance = await provider.getBalance(walletSponsor.address);
  console.log(`Sponsor ETH: ${formatEther(sponsorBalance)} ETH\n`);

  // Build token transfer calldata
  const transferData = tokenContract.interface.encodeFunctionData("transfer", [
    RECIPIENT,
    tokenBalance,
  ]);

  // Estimate gas for the token transfer
  let gasEstimate: BigNumber;
  try {
    gasEstimate = await provider.estimateGas({
      from: walletExecutor.address,
      to: TOKEN_ADDRESS,
      data: transferData,
    });
    // Add 20% buffer for safety
    gasEstimate = gasEstimate.mul(120).div(100);
  } catch (e: any) {
    console.warn(
      `Gas estimation failed (expected if executor has no ETH): ${e.message}`,
    );
    // Use a safe default for ERC-20 transfers
    gasEstimate = BigNumber.from(65000);
    console.log(`Using default gas limit: ${gasEstimate.toString()}`);
  }

  console.log(`Gas estimate: ${gasEstimate.toString()}`);

  // Pre-sign all transactions
  console.log("\n--- PRE-SIGNING TRANSACTIONS ---");

  const bundle = await signRescueBundle(
    provider,
    walletSponsor,
    walletExecutor,
    [
      {
        to: TOKEN_ADDRESS,
        data: transferData,
        gasLimit: gasEstimate,
      },
    ],
    PRIORITY_FEE_GWEI,
    MAX_FEE_GWEI,
    executorIsContract,
  );

  console.log(`Total gas cost: ${formatEther(bundle.totalGasCost)} ETH`);
  console.log(`Max fee: ${formatGwei(bundle.gasPrice)} gwei`);

  // Account for both executor gas cost AND the funding TX's own gas
  const fundingTxGas = BigNumber.from(21000).mul(bundle.gasPrice);
  const totalRequired = bundle.totalGasCost.add(fundingTxGas);

  if (sponsorBalance.lt(totalRequired)) {
    console.error(
      `\nERROR: Sponsor has insufficient ETH. Need ${formatEther(totalRequired)} ETH (${formatEther(bundle.totalGasCost)} for executor + ${formatEther(fundingTxGas)} for funding TX gas), have ${formatEther(sponsorBalance)} ETH`,
    );
    process.exit(1);
  }

  // Summary before execution
  console.log("\n========================================");
  console.log("  RESCUE SUMMARY");
  console.log("========================================");
  console.log(`Token:        ${formattedBalance} ${tokenSymbol}`);
  console.log(`Gas cost:     ${formatEther(bundle.totalGasCost)} ETH`);
  console.log(`TX Count:     1 funding + 1 transfer = 2 total`);
  console.log(`Strategy:     Submit funding, immediately blast transfer`);
  console.log("========================================\n");

  // Execute the rescue
  console.log(">>> EXECUTING RESCUE <<<\n");

  try {
    const result = await submitRescueBundle(provider, bundle);

    console.log("\n========================================");
    if (result.success) {
      console.log("  RESCUE SUCCESSFUL!");
      console.log(
        `  ${formattedBalance} ${tokenSymbol} transferred to ${RECIPIENT}`,
      );
    } else {
      console.log("  RESCUE FAILED");
      console.log(
        "  The sweeper may have drained the gas before the transfer executed.",
      );
      console.log("  Check the transaction hashes below for details.");
    }
    console.log("========================================");
    console.log(`Funding TX:  ${result.fundingHash}`);
    result.transferHashes.forEach((hash, i) => {
      console.log(`Transfer #${i}: ${hash}`);
    });
    console.log(
      `\nView on Basescan: https://basescan.org/tx/${result.transferHashes[0]}`,
    );
  } catch (e: any) {
    console.error(`\nRESCUE ERROR: ${e.message}`);

    if (e.message.includes("insufficient funds")) {
      console.error(
        "\nThe sweeper likely drained the ETH before the transfer could execute.",
      );
      console.error("Consider running the script again with higher gas fees.");
    }

    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
