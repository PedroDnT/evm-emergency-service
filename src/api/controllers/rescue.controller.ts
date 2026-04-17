import { Request, Response, NextFunction } from "express";
import { RescueService } from "../services/rescue.service";
import { FeeService } from "../services/fee.service";
import {
  RescueEstimateRequest,
  RescueEstimateResponse,
  RescueExecuteRequest,
  RescueExecuteResponse,
  RescueStatusResponse,
} from "../types";
import { randomBytes } from "crypto";

// In-memory storage for rescue status (stateless alternative: could use Redis)
const rescueStatus = new Map<string, {
  fundingTxHash?: string;
  transferTxHashes?: string[];
  status: 'pending' | 'success' | 'failed';
  recipientAddress: string;
  timestamp: number;
}>();

export class RescueController {
  private rescueService: RescueService;
  private feeService: FeeService;
  private sponsorAddress: string;
  private privateRpcUrl?: string;

  constructor(
    rpcUrl: string,
    sponsorAddress: string,
    feePercentage: number,
    serviceWalletAddress: string,
    privateRpcUrl?: string
  ) {
    this.rescueService = new RescueService(rpcUrl);
    this.feeService = new FeeService(feePercentage, serviceWalletAddress);
    this.sponsorAddress = sponsorAddress;
    this.privateRpcUrl = privateRpcUrl;
  }

  /**
   * POST /api/rescue/estimate
   * Calculate rescue cost and provide parameters for client-side signing
   */
  estimate = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { executorAddress, recipientAddress, tokenAddresses } =
        req.body as RescueEstimateRequest;

      // Validate input
      if (!executorAddress || !recipientAddress || !tokenAddresses?.length) {
        res.status(400).json({
          error: "Missing required fields: executorAddress, recipientAddress, tokenAddresses",
        });
        return;
      }

      // Fetch token information
      const tokenInfoPromises = tokenAddresses.map((addr) =>
        this.rescueService.getTokenInfo(addr, executorAddress)
      );
      const tokenResults = await Promise.all(tokenInfoPromises);
      const tokens = tokenResults.filter((t) => t !== null);

      if (tokens.length === 0) {
        res.status(400).json({
          error: "No tokens with non-zero balance found on executor wallet",
        });
        return;
      }

      // Get rescue parameters
      const params = await this.rescueService.getRescueParams(
        executorAddress,
        recipientAddress,
        tokens.map((t) => t.address),
        this.sponsorAddress
      );

      // Generate warnings
      const warnings = await this.rescueService.generateWarnings(executorAddress);

      // Generate rescue ID
      const rescueId = randomBytes(16).toString("hex");

      const response: RescueEstimateResponse = {
        tokens,
        estimatedGasCost: params.gasEstimates.totalGasLimit,
        serviceFeePercentage: this.feeService.getFeePercentage(),
        warnings,
        rescueId,
      };

      res.json(response);
    } catch (error: any) {
      next(error);
    }
  };

  /**
   * POST /api/rescue/params
   * Get signing parameters for client-side transaction signing
   */
  getParams = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { executorAddress, recipientAddress, tokenAddresses } = req.body;

      if (!executorAddress || !recipientAddress || !tokenAddresses?.length) {
        res.status(400).json({
          error: "Missing required fields",
        });
        return;
      }

      const params = await this.rescueService.getRescueParams(
        executorAddress,
        recipientAddress,
        tokenAddresses,
        this.sponsorAddress
      );

      res.json(params);
    } catch (error: any) {
      next(error);
    }
  };

  /**
   * POST /api/rescue/execute
   * Broadcast pre-signed transactions
   */
  execute = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { signedFundingTx, signedTransferTxs, recipientAddress, rescueId } =
        req.body as RescueExecuteRequest;

      if (!signedFundingTx || !signedTransferTxs?.length || !rescueId) {
        res.status(400).json({
          error: "Missing required fields: signedFundingTx, signedTransferTxs, rescueId",
        });
        return;
      }

      // Broadcast transactions
      const result = await this.rescueService.broadcastRescue(
        signedFundingTx,
        signedTransferTxs,
        this.privateRpcUrl
      );

      // Store status
      rescueStatus.set(rescueId, {
        fundingTxHash: result.fundingTxHash,
        transferTxHashes: result.transferTxHashes,
        status: 'pending',
        recipientAddress,
        timestamp: Date.now(),
      });

      const response: RescueExecuteResponse = {
        rescueId,
        status: 'pending',
        fundingTxHash: result.fundingTxHash,
        transferTxHashes: result.transferTxHashes,
      };

      res.json(response);
    } catch (error: any) {
      next(error);
    }
  };

  /**
   * GET /api/rescue/status/:rescueId
   * Check status of a rescue operation
   */
  getStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { rescueId } = req.params;

      const rescue = rescueStatus.get(rescueId);
      if (!rescue) {
        res.status(404).json({
          error: "Rescue not found",
        });
        return;
      }

      // Check transaction status
      let allConfirmed = true;
      let minConfirmations = 999;
      let anyFailed = false;

      if (rescue.fundingTxHash) {
        const fundingStatus = await this.rescueService.getTransactionStatus(
          rescue.fundingTxHash
        );
        if (!fundingStatus.confirmed) {
          allConfirmed = false;
        } else {
          minConfirmations = Math.min(minConfirmations, fundingStatus.confirmations);
          if (fundingStatus.status === 0) {
            anyFailed = true;
          }
        }
      }

      if (rescue.transferTxHashes) {
        for (const txHash of rescue.transferTxHashes) {
          const txStatus = await this.rescueService.getTransactionStatus(txHash);
          if (!txStatus.confirmed) {
            allConfirmed = false;
          } else {
            minConfirmations = Math.min(minConfirmations, txStatus.confirmations);
            if (txStatus.status === 0) {
              anyFailed = true;
            }
          }
        }
      }

      // Update status
      if (anyFailed) {
        rescue.status = 'failed';
      } else if (allConfirmed) {
        rescue.status = 'success';
      }

      const response: RescueStatusResponse = {
        rescueId,
        status: rescue.status,
        fundingTxHash: rescue.fundingTxHash,
        transferTxHashes: rescue.transferTxHashes,
        confirmations: allConfirmed ? minConfirmations : 0,
      };

      res.json(response);
    } catch (error: any) {
      next(error);
    }
  };
}
