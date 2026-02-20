import {
  FlashbotsBundleProvider,
  FlashbotsBundleRawTransaction,
  FlashbotsBundleTransaction,
} from "@flashbots/ethers-provider-bundle";
import { BigNumber } from "ethers";
import { parseTransaction } from "ethers/lib/utils";

export const ETHER = BigNumber.from(10).pow(18);
export const GWEI = BigNumber.from(10).pow(9);

/**
 * Attempt to decode a revert reason from a raw hex revert string.
 * Flashbots returns revert data as a hex string; standard ABI encoding
 * wraps the message as: 0x08c379a0 + abi.encode(string).
 */
function decodeRevertReason(revert: string | undefined): string {
  if (!revert || revert === "0x") return "(no revert data)";
  try {
    // Standard Error(string) selector: 0x08c379a0
    if (revert.startsWith("0x08c379a0")) {
      const encoded = "0x" + revert.slice(10); // strip selector
      // ABI-encoded string: 32 bytes offset (ignored) + 32 bytes length + data
      // Need at least 130 hex chars (including 0x) to safely read the length word.
      if (encoded.length < 130) {
        return `(raw: ${revert})`;
      }
      const length = parseInt(encoded.slice(66, 130), 16) * 2;
      // Ensure the encoded data is long enough to contain the full string.
      if (encoded.length < 130 + length) {
        return `(raw: ${revert})`;
      }
      const data = encoded.slice(130, 130 + length);
      return Buffer.from(data, "hex").toString("utf8");
    }
    // Panic(uint256) selector: 0x4e487b71
    if (revert.startsWith("0x4e487b71")) {
      const code = parseInt(revert.slice(10), 16);
      const panicCodes: Record<number, string> = {
        0x00: "generic panic",
        0x01: "assert failed",
        0x11: "arithmetic overflow/underflow",
        0x12: "division by zero",
        0x21: "invalid enum value",
        0x22: "incorrect storage byte array encoding",
        0x31: "pop on empty array",
        0x32: "array index out of bounds",
        0x41: "too much memory allocated",
        0x51: "zero-initialized function pointer called",
      };
      return `Panic(${panicCodes[code] ?? `code 0x${code.toString(16)}`})`;
    }
    // Unknown revert — return raw hex
    return `(raw: ${revert})`;
  } catch {
    return `(raw: ${revert})`;
  }
}

export async function checkSimulation(
  flashbotsProvider: FlashbotsBundleProvider,
  signedBundle: Array<string>,
  simulateOnly = false,
): Promise<BigNumber | null> {
  const simulationResponse = await flashbotsProvider.simulate(
    signedBundle,
    "latest",
  );

  if ("results" in simulationResponse) {
    for (let i = 0; i < simulationResponse.results.length; i++) {
      const txSimulation = simulationResponse.results[i];
      if ("error" in txSimulation) {
        const revertReason = decodeRevertReason((txSimulation as any).revert);
        const msg = `TX #${i}: ${txSimulation.error} — revert reason: ${revertReason}`;
        if (simulateOnly) {
          console.warn(`[SIMULATION WARN] ${msg}`);
          return null;
        }
        throw new Error(msg);
      }
    }

    if (simulationResponse.coinbaseDiff.eq(0)) {
      const msg = "Does not pay coinbase";
      if (simulateOnly) {
        console.warn(`[SIMULATION WARN] ${msg}`);
        return null;
      }
      throw new Error(msg);
    }

    const gasUsed = simulationResponse.results.reduce(
      (acc: number, txSimulation) =>
        acc + ("gasUsed" in txSimulation ? txSimulation.gasUsed : 0),
      0,
    );

    if (gasUsed === 0) {
      const msg = "Simulation used zero gas";
      if (simulateOnly) {
        console.warn(`[SIMULATION WARN] ${msg}`);
        return null;
      }
      throw new Error(msg);
    }
    const gasPrice = simulationResponse.coinbaseDiff.div(gasUsed);
    return gasPrice;
  }

  const msg = `Simulation failed, error code: ${simulationResponse.error.code} — ${simulationResponse.error.message}`;
  if (simulateOnly) {
    console.warn(`[SIMULATION WARN] ${msg}`);
    return null;
  }
  throw new Error(msg);
}

export async function printTransactions(
  bundleTransactions: Array<
    FlashbotsBundleTransaction | FlashbotsBundleRawTransaction
  >,
  signedBundle: Array<string>,
): Promise<void> {
  console.log("--------------------------------");
  console.log(
    (
      await Promise.all(
        bundleTransactions.map(async (bundleTx, index) => {
          const tx =
            "signedTransaction" in bundleTx
              ? parseTransaction(bundleTx.signedTransaction)
              : bundleTx.transaction;
          const from =
            "signer" in bundleTx ? await bundleTx.signer.getAddress() : tx.from;

          return `TX #${index}: ${from} => ${tx.to} : ${tx.data}`;
        }),
      )
    ).join("\n"),
  );

  console.log("--------------------------------");
  console.log(
    (
      await Promise.all(
        signedBundle.map(
          async (signedTx, index) => `TX #${index}: ${signedTx}`,
        ),
      )
    ).join("\n"),
  );

  console.log("--------------------------------");
}

export function gasPriceToGwei(gasPrice: BigNumber): number {
  return gasPrice.mul(100).div(GWEI).toNumber() / 100;
}
