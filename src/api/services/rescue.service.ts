import { BigNumber, Contract, providers, utils } from "ethers";
import { TokenInfo, RescueParams } from "../types";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
];

export class RescueService {
  private provider: providers.JsonRpcProvider;

  constructor(rpcUrl: string) {
    this.provider = new providers.JsonRpcProvider(rpcUrl);
  }

  /**
   * Fetch token information and balances for the executor wallet
   */
  async getTokenInfo(
    tokenAddress: string,
    executorAddress: string
  ): Promise<TokenInfo | null> {
    const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);

    try {
      const [name, symbol, decimals, balance] = await Promise.all([
        contract.name(),
        contract.symbol(),
        contract.decimals(),
        contract.balanceOf(executorAddress),
      ]);

      if (balance.isZero()) {
        return null;
      }

      return {
        address: tokenAddress,
        name,
        symbol,
        decimals,
        balance: utils.formatUnits(balance, decimals),
      };
    } catch (e: any) {
      console.warn(`Failed to read token at ${tokenAddress}: ${e.message}`);
      return null;
    }
  }

  /**
   * Get rescue parameters needed for client-side signing
   */
  async getRescueParams(
    executorAddress: string,
    recipientAddress: string,
    tokenAddresses: string[],
    sponsorAddress: string
  ): Promise<RescueParams> {
    // Validate addresses
    if (!utils.isAddress(executorAddress)) {
      throw new Error("Invalid executor address");
    }
    if (!utils.isAddress(recipientAddress)) {
      throw new Error("Invalid recipient address");
    }
    if (!utils.isAddress(sponsorAddress)) {
      throw new Error("Invalid sponsor address");
    }

    for (const addr of tokenAddresses) {
      if (!utils.isAddress(addr)) {
        throw new Error(`Invalid token address: ${addr}`);
      }
    }

    // Fetch nonces
    const [executorNonce, sponsorNonce] = await Promise.all([
      this.provider.getTransactionCount(executorAddress, "pending"),
      this.provider.getTransactionCount(sponsorAddress, "pending"),
    ]);

    // Get current gas prices
    const block = await this.provider.getBlock("latest");
    const baseFee = block.baseFeePerGas || BigNumber.from(0);
    const priorityFee = utils.parseUnits("0.5", "gwei");
    const maxFee = baseFee.mul(2).add(priorityFee);

    // Estimate gas for token transfers
    const gasEstimates: BigNumber[] = [];
    for (const tokenAddr of tokenAddresses) {
      const contract = new Contract(tokenAddr, ERC20_ABI, this.provider);
      try {
        const balance = await contract.balanceOf(executorAddress);
        const data = contract.interface.encodeFunctionData("transfer", [
          recipientAddress,
          balance,
        ]);
        const estimate = await this.provider.estimateGas({
          from: executorAddress,
          to: tokenAddr,
          data,
        });
        gasEstimates.push(estimate.mul(120).div(100)); // +20% buffer
      } catch {
        gasEstimates.push(BigNumber.from(65000)); // Default fallback
      }
    }

    const totalGasLimit = gasEstimates.reduce(
      (acc, cur) => acc.add(cur),
      BigNumber.from(0)
    );

    const network = await this.provider.getNetwork();

    return {
      executorAddress,
      recipientAddress,
      tokenAddresses,
      nonces: {
        executor: executorNonce,
        sponsor: sponsorNonce,
      },
      gasEstimates: {
        maxFeePerGas: maxFee.toString(),
        maxPriorityFeePerGas: priorityFee.toString(),
        totalGasLimit: totalGasLimit.toString(),
      },
      chainId: network.chainId,
    };
  }

  /**
   * Broadcast pre-signed transactions to the network
   */
  async broadcastRescue(
    signedFundingTx: string,
    signedTransferTxs: string[],
    privateRpcUrl?: string
  ): Promise<{
    fundingTxHash: string;
    transferTxHashes: string[];
  }> {
    // Broadcast funding transaction
    const fundingResponse = await this.provider.sendTransaction(signedFundingTx);
    console.log(`Funding TX broadcast: ${fundingResponse.hash}`);

    // If private RPC is configured, also broadcast there
    if (privateRpcUrl) {
      const privateProvider = new providers.JsonRpcProvider(privateRpcUrl);
      privateProvider.sendTransaction(signedFundingTx).catch((e) => {
        console.warn(`Private RPC funding TX failed: ${e.message}`);
      });
    }

    // Immediately broadcast all transfer transactions
    const transferResults = await Promise.allSettled(
      signedTransferTxs.map(async (signedTx, i) => {
        const resp = await this.provider.sendTransaction(signedTx);

        // Also broadcast to private RPC if available
        if (privateRpcUrl) {
          const privateProvider = new providers.JsonRpcProvider(privateRpcUrl);
          privateProvider.sendTransaction(signedTx).catch((e) => {
            console.warn(`Private RPC transfer TX #${i} failed: ${e.message}`);
          });
        }

        return resp.hash;
      })
    );

    const transferTxHashes = transferResults
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<string>).value);

    return {
      fundingTxHash: fundingResponse.hash,
      transferTxHashes,
    };
  }

  /**
   * Get transaction status and confirmations
   */
  async getTransactionStatus(txHash: string): Promise<{
    confirmed: boolean;
    confirmations: number;
    status?: number;
  }> {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { confirmed: false, confirmations: 0 };
      }

      const currentBlock = await this.provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber + 1;

      return {
        confirmed: true,
        confirmations,
        status: receipt.status,
      };
    } catch (e) {
      return { confirmed: false, confirmations: 0 };
    }
  }

  /**
   * Check if executor wallet has contract code (EIP-7702 delegation)
   */
  async isContractWallet(address: string): Promise<boolean> {
    const code = await this.provider.getCode(address);
    return code !== "0x" && code.length > 2;
  }

  /**
   * Generate warnings based on wallet status
   */
  async generateWarnings(executorAddress: string): Promise<string[]> {
    const warnings: string[] = [];

    const isContract = await this.isContractWallet(executorAddress);
    if (isContract) {
      warnings.push(
        "WARNING: Executor wallet has contract code (possible EIP-7702 delegation). " +
        "The sweeper bot may intercept incoming ETH via delegated receive() function."
      );
    }

    const balance = await this.provider.getBalance(executorAddress);
    if (balance.gt(0)) {
      warnings.push(
        "WARNING: Executor wallet has existing ETH balance. " +
        "This may indicate the sweeper bot is not actively monitoring, or has different behavior."
      );
    }

    return warnings;
  }
}
