export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  estimatedValueUSD?: number;
}

export interface RescueEstimateRequest {
  executorAddress: string;
  recipientAddress: string;
  tokenAddresses: string[];
}

export interface RescueEstimateResponse {
  tokens: TokenInfo[];
  estimatedGasCost: string;
  serviceFeePercentage: number;
  warnings: string[];
  rescueId: string;
}

export interface RescueExecuteRequest {
  signedFundingTx: string;
  signedTransferTxs: string[];
  recipientAddress: string;
  rescueId: string;
}

export interface RescueExecuteResponse {
  rescueId: string;
  status: 'broadcasting' | 'pending' | 'success' | 'failed';
  fundingTxHash?: string;
  transferTxHashes?: string[];
  error?: string;
}

export interface RescueStatusResponse {
  rescueId: string;
  status: 'pending' | 'success' | 'failed';
  fundingTxHash?: string;
  transferTxHashes?: string[];
  confirmations: number;
  fee?: {
    amount: string;
    token: string;
    paid: boolean;
  };
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
