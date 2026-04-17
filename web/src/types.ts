export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  estimatedValueUSD?: number;
}

export interface RescueEstimate {
  tokens: TokenInfo[];
  estimatedGasCost: string;
  serviceFeePercentage: number;
  warnings: string[];
  rescueId: string;
}

export interface RescueParams {
  executorAddress: string;
  recipientAddress: string;
  tokenAddresses: string[];
  nonces: {
    executor: number;
    sponsor: number;
  };
  gasEstimates: {
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    totalGasLimit: string;
  };
  chainId: number;
}

export interface RescueResult {
  rescueId: string;
  status: 'broadcasting' | 'pending' | 'success' | 'failed';
  fundingTxHash?: string;
  transferTxHashes?: string[];
  error?: string;
}

export interface RescueStatus {
  rescueId: string;
  status: 'pending' | 'success' | 'failed';
  fundingTxHash?: string;
  transferTxHashes?: string[];
  confirmations: number;
}
