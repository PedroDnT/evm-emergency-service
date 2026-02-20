import { BigNumber, providers, Wallet, utils } from "ethers";

export const GWEI = BigNumber.from(10).pow(9);

export interface SignedRescueBundle {
  fundingTx: string; // signed raw tx: sponsor -> executor ETH
  transferTxs: string[]; // signed raw txs: executor -> recipient token transfers
  totalGasCost: BigNumber;
  gasPrice: BigNumber;
}

export interface RescueResult {
  fundingHash: string;
  transferHashes: string[];
  success: boolean;
  error?: string;
}

/**
 * Pre-sign all transactions in the rescue bundle.
 * MUST be called before any submission - all txs are signed atomically
 * with correct nonces to avoid race conditions.
 */
export async function signRescueBundle(
  provider: providers.JsonRpcProvider,
  walletSponsor: Wallet,
  walletExecutor: Wallet,
  tokenTransferTxs: Array<{ to: string; data: string; gasLimit: BigNumber }>,
  priorityFeeGwei: number = 0.5,
  maxFeeGwei: number = 2,
  executorIsContract: boolean = false,
): Promise<SignedRescueBundle> {
  const block = await provider.getBlock("latest");
  const baseFee = block.baseFeePerGas || BigNumber.from(0);
  const priorityFee = utils.parseUnits(priorityFeeGwei.toString(), "gwei");
  const maxFee = utils.parseUnits(maxFeeGwei.toString(), "gwei");

  // Use the higher of our max fee or baseFee * 2 + priority (to ensure inclusion)
  const effectiveMaxFee = baseFee.mul(2).add(priorityFee).gt(maxFee)
    ? baseFee.mul(2).add(priorityFee)
    : maxFee;

  // Calculate total gas needed by executor
  const totalExecutorGas = tokenTransferTxs.reduce(
    (acc, tx) => acc.add(tx.gasLimit),
    BigNumber.from(0),
  );
  const totalGasCost = totalExecutorGas.mul(effectiveMaxFee);

  // Get nonces - use "latest" for executor to avoid race conditions with sweeper
  const [sponsorNonce, executorNonce] = await Promise.all([
    provider.getTransactionCount(walletSponsor.address, "latest"),
    provider.getTransactionCount(walletExecutor.address, "latest"),
  ]);

  const chainId = (await provider.getNetwork()).chainId;

  // Sign funding tx: sponsor -> executor
  // EIP-7702 delegated accounts may need more gas for receive()
  const fundingGasLimit = executorIsContract ? 100000 : 21000;
  const fundingTx = await walletSponsor.signTransaction({
    to: walletExecutor.address,
    value: totalGasCost,
    gasLimit: fundingGasLimit,
    maxFeePerGas: effectiveMaxFee,
    maxPriorityFeePerGas: priorityFee,
    nonce: sponsorNonce,
    type: 2,
    chainId,
  });

  // Sign token transfer txs: executor -> recipient
  const transferTxs: string[] = [];
  for (let i = 0; i < tokenTransferTxs.length; i++) {
    const tx = tokenTransferTxs[i];
    const signed = await walletExecutor.signTransaction({
      to: tx.to,
      data: tx.data,
      gasLimit: tx.gasLimit,
      maxFeePerGas: effectiveMaxFee,
      maxPriorityFeePerGas: priorityFee,
      nonce: executorNonce + i,
      value: 0,
      type: 2,
      chainId,
    });
    transferTxs.push(signed);
  }

  return {
    fundingTx,
    transferTxs,
    totalGasCost,
    gasPrice: effectiveMaxFee,
  };
}

/**
 * Submit all signed transactions as fast as possible.
 * Sends funding tx first, then blasts all transfer txs in parallel.
 * Does NOT wait for confirmations between submissions.
 */
export async function submitRescueBundle(
  provider: providers.JsonRpcProvider,
  bundle: SignedRescueBundle,
): Promise<RescueResult> {
  // Submit funding tx
  const fundingResponse = await provider.sendTransaction(bundle.fundingTx);
  console.log(`[SENT] Funding TX: ${fundingResponse.hash}`);

  // Immediately blast all transfer txs without waiting for funding confirmation
  const transferResults = await Promise.all(
    bundle.transferTxs.map(async (signedTx, i) => {
      try {
        const resp = await provider.sendTransaction(signedTx);
        console.log(`[SENT] Transfer TX #${i}: ${resp.hash}`);
        return { success: true as const, response: resp, index: i };
      } catch (error: any) {
        console.error(`[SEND FAILED] Transfer TX #${i}: ${error.message}`);
        return { success: false as const, error: error.message, index: i };
      }
    }),
  );

  const successfulTransfers = transferResults.filter(
    (
      r,
    ): r is {
      success: true;
      response: providers.TransactionResponse;
      index: number;
    } => r.success,
  );

  if (successfulTransfers.length === 0) {
    return {
      fundingHash: fundingResponse.hash,
      transferHashes: [],
      success: false,
      error: "All transfer transactions failed to submit",
    };
  }

  const transferResponses = successfulTransfers.map((r) => r.response);

  console.log("\n[WAITING] Waiting for funding TX confirmation...");
  const fundingReceipt = await fundingResponse.wait(1);
  console.log(
    `[CONFIRMED] Funding TX in block ${fundingReceipt.blockNumber} | Gas used: ${fundingReceipt.gasUsed.toString()}`,
  );

  console.log("[WAITING] Waiting for transfer TX confirmations...");
  const transferReceipts = await Promise.all(
    transferResponses.map((resp) => resp.wait(1)),
  );

  let allSuccess = true;
  for (let i = 0; i < transferReceipts.length; i++) {
    const receipt = transferReceipts[i];
    const status = receipt.status === 1 ? "SUCCESS" : "FAILED";
    if (receipt.status !== 1) allSuccess = false;
    console.log(
      `[${status}] Transfer TX #${i} in block ${receipt.blockNumber} | Gas used: ${receipt.gasUsed.toString()}`,
    );
  }

  return {
    fundingHash: fundingResponse.hash,
    transferHashes: transferResponses.map((r) => r.hash),
    success: allSuccess,
  };
}

export function formatEther(wei: BigNumber): string {
  return utils.formatEther(wei);
}

export function formatGwei(wei: BigNumber): string {
  return utils.formatUnits(wei, "gwei");
}
