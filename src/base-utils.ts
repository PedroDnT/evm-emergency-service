import { BigNumber, providers, Wallet, utils } from "ethers";

export const GWEI = BigNumber.from(10).pow(9);

// Maximum retry attempts for failed rescues
const MAX_RETRY_ATTEMPTS = 3;
// Gas multiplier per retry (1.3x each attempt)
const GAS_ESCALATION_FACTOR = 130; // percent
// Max fee cap to avoid runaway costs (10 gwei for Base)
const MAX_FEE_CAP_GWEI = 10;

export interface SignedRescueBundle {
  fundingTx: string; // signed raw tx: sponsor -> executor ETH
  transferTxs: string[]; // signed raw txs: executor -> recipient token transfers
  totalGasCost: BigNumber;
  gasPrice: BigNumber;
  // Stored for retry: re-sign without repeating all setup
  sponsorAddress: string;
  executorAddress: string;
  executorNonce: number;
  sponsorNonce: number;
}

export interface RescueResult {
  fundingHash: string;
  transferHashes: string[];
  success: boolean;
  attempts: number;
  error?: string;
}

export interface TokenTransferTx {
  to: string;
  data: string;
  gasLimit: BigNumber;
}

/**
 * Fetch current nonces for sponsor and executor using "pending" to account
 * for any in-flight transactions (including sweeper bot activity).
 */
export async function fetchNonces(
  provider: providers.JsonRpcProvider,
  sponsorAddress: string,
  executorAddress: string,
): Promise<{ sponsorNonce: number; executorNonce: number }> {
  const [sponsorNonce, executorNonce] = await Promise.all([
    provider.getTransactionCount(sponsorAddress, "pending"),
    provider.getTransactionCount(executorAddress, "pending"),
  ]);
  return { sponsorNonce, executorNonce };
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
  tokenTransferTxs: TokenTransferTx[],
  priorityFeeGwei: number = 0.5,
  maxFeeGwei: number = 2,
  executorIsContract: boolean = false,
  gasFactor: number = 100, // percentage multiplier for escalation (100 = no escalation)
): Promise<SignedRescueBundle> {
  const block = await provider.getBlock("latest");
  const baseFee = block.baseFeePerGas || BigNumber.from(0);
  const priorityFee = utils.parseUnits(priorityFeeGwei.toString(), "gwei");

  // Scale the configured max fee by the escalation factor
  const scaledMaxFeeGwei = (maxFeeGwei * gasFactor) / 100;
  const cappedMaxFeeGwei = Math.min(scaledMaxFeeGwei, MAX_FEE_CAP_GWEI);
  const maxFee = utils.parseUnits(cappedMaxFeeGwei.toString(), "gwei");

  // Use the higher of configured max fee or baseFee * 2 + priority (to ensure inclusion)
  const effectiveMaxFee = baseFee.mul(2).add(priorityFee).gt(maxFee)
    ? baseFee.mul(2).add(priorityFee)
    : maxFee;

  // Calculate total gas needed by executor
  const totalExecutorGas = tokenTransferTxs.reduce(
    (acc, tx) => acc.add(tx.gasLimit),
    BigNumber.from(0),
  );
  const totalGasCost = totalExecutorGas.mul(effectiveMaxFee);

  // Fetch fresh nonces using "pending" to detect sweeper activity
  const { sponsorNonce, executorNonce } = await fetchNonces(
    provider,
    walletSponsor.address,
    walletExecutor.address,
  );

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
    sponsorAddress: walletSponsor.address,
    executorAddress: walletExecutor.address,
    executorNonce,
    sponsorNonce,
  };
}

/**
 * Re-sign only the transfer transactions with a fresh nonce.
 * Used when funding TX succeeded but transfers failed due to nonce conflict.
 */
async function resignTransferTxs(
  provider: providers.JsonRpcProvider,
  walletExecutor: Wallet,
  tokenTransferTxs: TokenTransferTx[],
  gasPrice: BigNumber,
  priorityFee: BigNumber,
): Promise<{ txs: string[]; nonce: number }> {
  const chainId = (await provider.getNetwork()).chainId;
  const nonce = await provider.getTransactionCount(
    walletExecutor.address,
    "pending",
  );

  const txs: string[] = [];
  for (let i = 0; i < tokenTransferTxs.length; i++) {
    const tx = tokenTransferTxs[i];
    const signed = await walletExecutor.signTransaction({
      to: tx.to,
      data: tx.data,
      gasLimit: tx.gasLimit,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: priorityFee,
      nonce: nonce + i,
      value: 0,
      type: 2,
      chainId,
    });
    txs.push(signed);
  }

  return { txs, nonce };
}

/**
 * Check if executor has received the funding (ETH balance >= expected).
 */
async function isFunded(
  provider: providers.JsonRpcProvider,
  executorAddress: string,
  expectedAmount: BigNumber,
): Promise<boolean> {
  const balance = await provider.getBalance(executorAddress);
  return balance.gte(expectedAmount);
}

/**
 * Submit all signed transactions as fast as possible.
 * Sends funding tx first, then blasts all transfer txs in parallel.
 * Implements retry loop with gas escalation on failure.
 *
 * Retry strategy:
 *   Attempt 1: original gas price
 *   Attempt 2: 1.3x gas price, fresh nonces
 *   Attempt 3: 1.69x gas price, fresh nonces
 */
export async function submitRescueBundle(
  provider: providers.JsonRpcProvider,
  bundle: SignedRescueBundle,
  walletExecutor: Wallet,
  walletSponsor: Wallet,
  tokenTransferTxs: TokenTransferTx[],
  priorityFeeGwei: number = 0.5,
  executorIsContract: boolean = false,
): Promise<RescueResult> {
  let lastError: string | undefined;
  let gasFactor = 100; // starts at 100% (no escalation)

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      gasFactor = Math.round(gasFactor * (GAS_ESCALATION_FACTOR / 100));
      const escalatedGwei = (
        (parseFloat(utils.formatUnits(bundle.gasPrice, "gwei")) * gasFactor) /
        100
      ).toFixed(3);
      console.log(
        `\n[RETRY] Attempt ${attempt}/${MAX_RETRY_ATTEMPTS} | Gas: ${escalatedGwei} gwei`,
      );

      // Re-sign the entire bundle with fresh nonces and escalated gas
      try {
        bundle = await signRescueBundle(
          provider,
          walletSponsor,
          walletExecutor,
          tokenTransferTxs,
          priorityFeeGwei,
          parseFloat(utils.formatUnits(bundle.gasPrice, "gwei")),
          executorIsContract,
          gasFactor,
        );
      } catch (e: any) {
        console.error(`[RETRY] Failed to re-sign bundle: ${e.message}`);
        lastError = e.message;
        continue;
      }
    }

    try {
      const result = await attemptSubmission(
        provider,
        bundle,
        walletExecutor,
        tokenTransferTxs,
        priorityFeeGwei,
        attempt,
      );

      if (result.success) {
        return { ...result, attempts: attempt };
      }

      lastError = result.error;

      // Check if funding landed — if yes, only re-sign transfers next attempt
      const funded = await isFunded(
        provider,
        bundle.executorAddress,
        bundle.totalGasCost,
      );
      if (funded && attempt < MAX_RETRY_ATTEMPTS) {
        console.log(
          "[RETRY] Funding confirmed, but transfer failed. Re-submitting transfer only with fresh nonce.",
        );
        const priorityFee = utils.parseUnits(priorityFeeGwei.toString(), "gwei");
        const escalatedGas = bundle.gasPrice
          .mul(GAS_ESCALATION_FACTOR)
          .div(100);
        const { txs: freshTransferTxs } = await resignTransferTxs(
          provider,
          walletExecutor,
          tokenTransferTxs,
          escalatedGas,
          priorityFee,
        );
        bundle = { ...bundle, transferTxs: freshTransferTxs };
        // Submit only transfers (skip re-funding)
        const transferOnly = await submitTransfersOnly(
          provider,
          bundle.fundingHash ?? "",
          freshTransferTxs,
        );
        if (transferOnly.success) {
          return { ...transferOnly, attempts: attempt + 1 };
        }
        lastError = transferOnly.error;
      }
    } catch (e: any) {
      lastError = e.message;
      console.error(`[ATTEMPT ${attempt}] Error: ${e.message}`);
    }
  }

  return {
    fundingHash: "",
    transferHashes: [],
    success: false,
    attempts: MAX_RETRY_ATTEMPTS,
    error: lastError,
  };
}

/**
 * Single submission attempt: submit funding, guard nonce staleness, blast transfers.
 */
async function attemptSubmission(
  provider: providers.JsonRpcProvider,
  bundle: SignedRescueBundle,
  walletExecutor: Wallet,
  tokenTransferTxs: TokenTransferTx[],
  priorityFeeGwei: number,
  attempt: number,
): Promise<RescueResult & { fundingHash: string }> {
  // Guard: check executor nonce hasn't moved since signing
  const currentExecutorNonce = await provider.getTransactionCount(
    bundle.executorAddress,
    "pending",
  );
  if (currentExecutorNonce !== bundle.executorNonce) {
    console.warn(
      `[NONCE GUARD] Executor nonce changed: signed=${bundle.executorNonce}, current=${currentExecutorNonce}. Re-signing transfers.`,
    );
    const priorityFee = utils.parseUnits(priorityFeeGwei.toString(), "gwei");
    const { txs: freshTransferTxs } = await resignTransferTxs(
      provider,
      walletExecutor,
      tokenTransferTxs,
      bundle.gasPrice,
      priorityFee,
    );
    bundle = { ...bundle, transferTxs: freshTransferTxs };
  }

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
      attempts: attempt,
      error: "All transfer transactions failed to submit",
    };
  }

  const transferResponses = successfulTransfers.map((r) => r.response);

  console.log("\n[WAITING] Waiting for funding TX confirmation...");
  const fundingReceipt = await fundingResponse.wait(1);
  console.log(
    `[CONFIRMED] Funding TX in block ${fundingReceipt.blockNumber} | Gas used: ${fundingReceipt.gasUsed.toString()}`,
  );

  // Verify executor actually received funds before waiting for transfers
  const funded = await isFunded(
    provider,
    bundle.executorAddress,
    bundle.totalGasCost.div(2), // relaxed check: at least half (gas may have been used)
  );
  if (!funded) {
    console.warn(
      "[WARNING] Executor ETH balance lower than expected after funding TX. Sweeper may have drained it.",
    );
  }

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
    attempts: attempt,
    error: allSuccess ? undefined : "One or more transfer transactions reverted",
  };
}

/**
 * Submit only transfer transactions (when funding already confirmed).
 */
async function submitTransfersOnly(
  provider: providers.JsonRpcProvider,
  fundingHash: string,
  signedTransferTxs: string[],
): Promise<RescueResult> {
  const transferResults = await Promise.all(
    signedTransferTxs.map(async (signedTx, i) => {
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
    (r): r is { success: true; response: providers.TransactionResponse; index: number } =>
      r.success,
  );

  if (successfulTransfers.length === 0) {
    return {
      fundingHash,
      transferHashes: [],
      success: false,
      attempts: 1,
      error: "All transfer transactions failed to submit",
    };
  }

  const transferResponses = successfulTransfers.map((r) => r.response);

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
    fundingHash,
    transferHashes: transferResponses.map((r) => r.hash),
    success: allSuccess,
    attempts: 1,
    error: allSuccess ? undefined : "One or more transfer transactions reverted",
  };
}

export function formatEther(wei: BigNumber): string {
  return utils.formatEther(wei);
}

export function formatGwei(wei: BigNumber): string {
  return utils.formatUnits(wei, "gwei");
}
