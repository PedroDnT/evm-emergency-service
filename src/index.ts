import {
  FlashbotsBundleProvider,
  FlashbotsBundleRawTransaction,
  FlashbotsBundleResolution,
  FlashbotsBundleTransaction,
} from "@flashbots/ethers-provider-bundle";
import { BigNumber, providers, Wallet } from "ethers";
import { Base } from "./engine/Base";
import { checkSimulation, gasPriceToGwei, printTransactions } from "./utils";
import { Approval721 } from "./engine/Approval721";

require("log-timestamp");

const BLOCKS_IN_FUTURE = 2;
// Stop retrying after this many blocks without inclusion
const MAX_BLOCKS_WITHOUT_INCLUSION = 25;
// Gas escalation: 10% per missed block, capped at 5x initial
const GAS_ESCALATION_PER_BLOCK = 0.1;
const GAS_ESCALATION_CAP = 5.0;

const GWEI = BigNumber.from(10).pow(9);
const PRIORITY_GAS_PRICE = GWEI.mul(31);

const PRIVATE_KEY_EXECUTOR = process.env.PRIVATE_KEY_EXECUTOR || "";
const PRIVATE_KEY_SPONSOR = process.env.PRIVATE_KEY_SPONSOR || "";
const FLASHBOTS_RELAY_SIGNING_KEY =
  process.env.FLASHBOTS_RELAY_SIGNING_KEY || "";
const RECIPIENT = process.env.RECIPIENT || "";

if (PRIVATE_KEY_EXECUTOR === "") {
  console.warn(
    "Must provide PRIVATE_KEY_EXECUTOR environment variable, corresponding to Ethereum EOA with assets to be transferred",
  );
  process.exit(1);
}
if (PRIVATE_KEY_SPONSOR === "") {
  console.warn(
    "Must provide PRIVATE_KEY_SPONSOR environment variable, corresponding to an Ethereum EOA with ETH to pay miner",
  );
  process.exit(1);
}
if (FLASHBOTS_RELAY_SIGNING_KEY === "") {
  console.warn(
    "Must provide FLASHBOTS_RELAY_SIGNING_KEY environment variable. Please see https://github.com/flashbots/pm/blob/main/guides/flashbots-alpha.md",
  );
  process.exit(1);
}
if (RECIPIENT === "") {
  console.warn(
    "Must provide RECIPIENT environment variable, an address which will receive assets",
  );
  process.exit(1);
}

async function main() {
  const walletRelay = new Wallet(FLASHBOTS_RELAY_SIGNING_KEY);

  // ======= UNCOMMENT FOR GOERLI ==========
  const provider = new providers.InfuraProvider(
    5,
    process.env.INFURA_API_KEY || "",
  );
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    walletRelay,
    "https://relay-goerli.epheph.com/",
  );
  // ======= UNCOMMENT FOR GOERLI ==========

  // ======= UNCOMMENT FOR MAINNET ==========
  // const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL || "http://127.0.0.1:8545"
  // const provider = new providers.StaticJsonRpcProvider(ETHEREUM_RPC_URL);
  // const flashbotsProvider = await FlashbotsBundleProvider.create(provider, walletRelay);
  // ======= UNCOMMENT FOR MAINNET ==========

  const walletExecutor = new Wallet(PRIVATE_KEY_EXECUTOR);
  const walletSponsor = new Wallet(PRIVATE_KEY_SPONSOR);

  const block = await provider.getBlock("latest");
  const initialBaseFee = block.baseFeePerGas || BigNumber.from(0);

  // ======= UNCOMMENT FOR ERC20 TRANSFER ==========
  // const tokenAddress = "0x4da27a545c0c5B758a6BA100e3a049001de870f5";
  // const engine: Base = new TransferERC20(provider, walletExecutor.address, RECIPIENT, tokenAddress);
  // ======= UNCOMMENT FOR ERC20 TRANSFER ==========

  // ======= UNCOMMENT FOR 721 Approval ==========
  const HASHMASKS_ADDRESS = "0xC2C747E0F7004F9E8817Db2ca4997657a7746928";
  const engine: Base = new Approval721(RECIPIENT, [HASHMASKS_ADDRESS]);
  // ======= UNCOMMENT FOR 721 Approval ==========

  const sponsoredTransactions = await engine.getSponsoredTransactions();

  const gasEstimates = await Promise.all(
    sponsoredTransactions.map((tx) =>
      provider.estimateGas({
        ...tx,
        from: tx.from === undefined ? walletExecutor.address : tx.from,
      }),
    ),
  );
  const gasEstimateTotal = gasEstimates.reduce(
    (acc, cur) => acc.add(cur),
    BigNumber.from(0),
  );

  const initialGasPrice = PRIORITY_GAS_PRICE.add(initialBaseFee);

  /**
   * Build a signed bundle using the current gas price.
   * Called on first submission and after each AccountNonceTooHigh event.
   */
  async function buildBundle(
    gasPrice: BigNumber,
  ): Promise<
    Array<FlashbotsBundleTransaction | FlashbotsBundleRawTransaction>
  > {
    return [
      {
        transaction: {
          to: walletExecutor.address,
          gasPrice: gasPrice,
          value: gasEstimateTotal.mul(gasPrice),
          gasLimit: 21000,
        },
        signer: walletSponsor,
      },
      ...sponsoredTransactions.map((transaction, txNumber) => ({
        transaction: {
          ...transaction,
          gasPrice: gasPrice,
          gasLimit: gasEstimates[txNumber],
        },
        signer: walletExecutor,
      })),
    ];
  }

  let bundleTransactions = await buildBundle(initialGasPrice);
  let signedBundle = await flashbotsProvider.signBundle(bundleTransactions);
  await printTransactions(bundleTransactions, signedBundle);
  const simulatedGasPrice = await checkSimulation(
    flashbotsProvider,
    signedBundle,
  );

  console.log(await engine.description());
  console.log(`Executor Account: ${walletExecutor.address}`);
  console.log(`Sponsor Account: ${walletSponsor.address}`);
  console.log(
    `Simulated Gas Price: ${simulatedGasPrice !== null ? gasPriceToGwei(simulatedGasPrice) : "n/a"} gwei`,
  );
  console.log(`Gas Price: ${gasPriceToGwei(initialGasPrice)} gwei`);
  console.log(`Gas Used: ${gasEstimateTotal.toString()}`);
  console.log(`Max blocks without inclusion: ${MAX_BLOCKS_WITHOUT_INCLUSION}`);

  let blocksMissed = 0;
  let currentGasPrice = initialGasPrice;

  provider.on("block", async (blockNumber) => {
    // Enforce block timeout
    if (blocksMissed >= MAX_BLOCKS_WITHOUT_INCLUSION) {
      console.error(
        `\nTIMEOUT: Bundle not included in ${MAX_BLOCKS_WITHOUT_INCLUSION} blocks. Giving up.`,
      );
      console.error(
        "Consider re-running with a higher PRIORITY_GAS_PRICE or check bundle validity.",
      );
      process.exit(1);
    }

    // Escalate gas price proportionally to blocks missed
    const escalationFactor = Math.min(
      1 + blocksMissed * GAS_ESCALATION_PER_BLOCK,
      GAS_ESCALATION_CAP,
    );
    const escalatedGasPrice = initialGasPrice
      .mul(Math.round(escalationFactor * 100))
      .div(100);

    if (escalatedGasPrice.gt(currentGasPrice)) {
      currentGasPrice = escalatedGasPrice;
      console.log(
        `[GAS ESCALATION] Block ${blockNumber}: ${gasPriceToGwei(currentGasPrice)} gwei (${escalationFactor.toFixed(2)}x initial)`,
      );
      // Re-build and re-sign bundle with new gas price
      bundleTransactions = await buildBundle(currentGasPrice);
      signedBundle = await flashbotsProvider.signBundle(bundleTransactions);
    }

    let currentSimulatedGasPrice: BigNumber | null;
    try {
      currentSimulatedGasPrice = await checkSimulation(
        flashbotsProvider,
        signedBundle,
      );
    } catch (e: any) {
      console.warn(`[SIMULATION WARN] Block ${blockNumber}: ${e.message}`);
      blocksMissed++;
      return;
    }
    if (currentSimulatedGasPrice === null) {
      console.warn(
        `[SIMULATION WARN] Block ${blockNumber}: simulation returned null`,
      );
      blocksMissed++;
      return;
    }

    const targetBlockNumber = blockNumber + BLOCKS_IN_FUTURE;
    console.log(
      `Block: ${blockNumber} | Target: ${targetBlockNumber} | Gas: ${gasPriceToGwei(currentSimulatedGasPrice)} gwei | Missed: ${blocksMissed}`,
    );

    const bundleResponse = await flashbotsProvider.sendBundle(
      bundleTransactions,
      targetBlockNumber,
    );
    if ("error" in bundleResponse) {
      console.error(`Bundle submission error: ${bundleResponse.error.message}`);
      blocksMissed++;
      return;
    }

    const bundleResolution = await bundleResponse.wait();

    if (bundleResolution === FlashbotsBundleResolution.BundleIncluded) {
      console.log(`\nSUCCESS: Bundle included in block ${targetBlockNumber}`);
      process.exit(0);
    } else if (
      bundleResolution === FlashbotsBundleResolution.BlockPassedWithoutInclusion
    ) {
      console.log(`Not included in ${targetBlockNumber}`);
      blocksMissed++;
    } else if (
      bundleResolution === FlashbotsBundleResolution.AccountNonceTooHigh
    ) {
      // Nonce recovery: fetch current nonce and re-sign with updated base
      console.warn(
        "[NONCE RECOVERY] AccountNonceTooHigh — fetching fresh nonces and re-signing bundle.",
      );
      try {
        bundleTransactions = await buildBundle(currentGasPrice);
        signedBundle = await flashbotsProvider.signBundle(bundleTransactions);
        console.log("[NONCE RECOVERY] Bundle re-signed successfully.");
      } catch (e: any) {
        console.error(`[NONCE RECOVERY] Failed to re-sign: ${e.message}`);
        process.exit(1);
      }
      // Do not increment blocksMissed — nonce recovery is not a "miss"
    }
  });
}

main();
