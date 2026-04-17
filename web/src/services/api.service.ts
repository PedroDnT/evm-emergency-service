import { RescueEstimate, RescueParams, RescueResult, RescueStatus } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

class ApiService {
  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Network error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async estimateRescue(
    executorAddress: string,
    recipientAddress: string,
    tokenAddresses: string[]
  ): Promise<RescueEstimate> {
    return this.fetch<RescueEstimate>('/rescue/estimate', {
      method: 'POST',
      body: JSON.stringify({
        executorAddress,
        recipientAddress,
        tokenAddresses,
      }),
    });
  }

  async getRescueParams(
    executorAddress: string,
    recipientAddress: string,
    tokenAddresses: string[]
  ): Promise<RescueParams> {
    return this.fetch<RescueParams>('/rescue/params', {
      method: 'POST',
      body: JSON.stringify({
        executorAddress,
        recipientAddress,
        tokenAddresses,
      }),
    });
  }

  async executeRescue(
    signedFundingTx: string,
    signedTransferTxs: string[],
    recipientAddress: string,
    rescueId: string
  ): Promise<RescueResult> {
    return this.fetch<RescueResult>('/rescue/execute', {
      method: 'POST',
      body: JSON.stringify({
        signedFundingTx,
        signedTransferTxs,
        recipientAddress,
        rescueId,
      }),
    });
  }

  async getRescueStatus(rescueId: string): Promise<RescueStatus> {
    return this.fetch<RescueStatus>(`/rescue/status/${rescueId}`);
  }

  async checkHealth(): Promise<{ status: string; timestamp: number }> {
    return this.fetch('/health');
  }
}

export const apiService = new ApiService();
