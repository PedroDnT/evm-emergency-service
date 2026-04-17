import { TokenInfo } from "../types";

export class FeeService {
  private feePercentage: number;
  private serviceWalletAddress: string;

  constructor(feePercentage: number = 5, serviceWalletAddress: string) {
    this.feePercentage = feePercentage;
    this.serviceWalletAddress = serviceWalletAddress;
  }

  /**
   * Calculate service fee for rescued tokens
   */
  calculateFee(tokens: TokenInfo[]): {
    feePercentage: number;
    serviceWallet: string;
    estimatedFeeUSD?: number;
  } {
    let totalValueUSD = 0;
    for (const token of tokens) {
      if (token.estimatedValueUSD) {
        totalValueUSD += token.estimatedValueUSD;
      }
    }

    const estimatedFeeUSD = totalValueUSD > 0
      ? (totalValueUSD * this.feePercentage) / 100
      : undefined;

    return {
      feePercentage: this.feePercentage,
      serviceWallet: this.serviceWalletAddress,
      estimatedFeeUSD,
    };
  }

  /**
   * Generate payment request message for user
   */
  generatePaymentRequest(tokens: TokenInfo[], rescueId: string): string {
    const feeInfo = this.calculateFee(tokens);

    let message = `🎉 Rescue Successful!\n\n`;
    message += `Rescued tokens:\n`;
    tokens.forEach(token => {
      message += `  • ${token.balance} ${token.symbol}\n`;
    });

    message += `\nService fee: ${this.feePercentage}%\n`;
    if (feeInfo.estimatedFeeUSD) {
      message += `Estimated: $${feeInfo.estimatedFeeUSD.toFixed(2)} USD\n`;
    }

    message += `\nPlease send payment to: ${this.serviceWalletAddress}\n`;
    message += `Reference ID: ${rescueId}\n`;

    return message;
  }

  getServiceWallet(): string {
    return this.serviceWalletAddress;
  }

  getFeePercentage(): number {
    return this.feePercentage;
  }
}
