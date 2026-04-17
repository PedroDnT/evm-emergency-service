import { Wallet, Contract, utils, BigNumber } from 'ethers';
import { RescueParams, TokenInfo } from '../types';

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
];

export class SigningService {
  /**
   * Sign transfer transactions for the compromised wallet
   */
  async signTransferTransactions(
    privateKey: string,
    params: RescueParams,
    tokens: TokenInfo[]
  ): Promise<string[]> {
    // Validate private key format
    const normalizedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    if (normalizedKey.length !== 66) {
      throw new Error('Invalid private key format (must be 64 hex characters)');
    }

    const wallet = new Wallet(normalizedKey);

    // Verify wallet address matches executor
    if (wallet.address.toLowerCase() !== params.executorAddress.toLowerCase()) {
      throw new Error('Private key does not match the compromised wallet address');
    }

    const signedTxs: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // Create contract interface to encode transfer data
      const contract = new Contract(token.address, ERC20_ABI);

      // Convert balance string to BigNumber with decimals
      const balance = utils.parseUnits(token.balance, token.decimals);

      // Encode transfer function call
      const data = contract.interface.encodeFunctionData('transfer', [
        params.recipientAddress,
        balance,
      ]);

      // Estimate gas limit (use a reasonable default with buffer)
      const gasLimit = BigNumber.from(65000).add(
        BigNumber.from(params.gasEstimates.totalGasLimit).div(tokens.length)
      );

      // Sign transaction
      const signedTx = await wallet.signTransaction({
        to: token.address,
        data,
        gasLimit,
        maxFeePerGas: params.gasEstimates.maxFeePerGas,
        maxPriorityFeePerGas: params.gasEstimates.maxPriorityFeePerGas,
        nonce: params.nonces.executor + i,
        value: 0,
        type: 2,
        chainId: params.chainId,
      });

      signedTxs.push(signedTx);
    }

    return signedTxs;
  }

  /**
   * Validate an Ethereum address
   */
  isValidAddress(address: string): boolean {
    return utils.isAddress(address);
  }

  /**
   * Validate a private key format (without creating wallet)
   */
  isValidPrivateKey(key: string): boolean {
    try {
      const normalized = key.startsWith('0x') ? key : `0x${key}`;
      return normalized.length === 66 && /^0x[0-9a-fA-F]{64}$/.test(normalized);
    } catch {
      return false;
    }
  }
}

export const signingService = new SigningService();
