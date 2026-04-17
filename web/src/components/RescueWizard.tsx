import { useState } from 'react';
import { TokenInfo, RescueEstimate, RescueParams } from '../types';
import { apiService } from '../services/api.service';
import { signingService } from '../services/signing.service';

interface RescueWizardProps {
  onComplete: () => void;
}

type Step = 'input' | 'estimate' | 'sign' | 'execute' | 'monitor';

export function RescueWizard({ onComplete }: RescueWizardProps) {
  const [step, setStep] = useState<Step>('input');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Form data
  const [compromisedAddress, setCompromisedAddress] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [tokenAddresses, setTokenAddresses] = useState('');
  const [privateKey, setPrivateKey] = useState('');

  // Rescue data
  const [estimate, setEstimate] = useState<RescueEstimate | null>(null);
  const [params, setParams] = useState<RescueParams | null>(null);
  const [rescueId, setRescueId] = useState<string>('');
  const [fundingTxHash, setFundingTxHash] = useState<string>('');
  const [transferTxHashes, setTransferTxHashes] = useState<string[]>([]);

  const handleEstimate = async () => {
    setError('');
    setLoading(true);

    try {
      // Validate addresses
      if (!signingService.isValidAddress(compromisedAddress)) {
        throw new Error('Invalid compromised wallet address');
      }
      if (!signingService.isValidAddress(recipientAddress)) {
        throw new Error('Invalid recipient address');
      }

      const tokens = tokenAddresses
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      if (tokens.length === 0) {
        throw new Error('Please enter at least one token address');
      }

      for (const addr of tokens) {
        if (!signingService.isValidAddress(addr)) {
          throw new Error(`Invalid token address: ${addr}`);
        }
      }

      // Get estimate
      const estimateResult = await apiService.estimateRescue(
        compromisedAddress,
        recipientAddress,
        tokens
      );

      setEstimate(estimateResult);
      setRescueId(estimateResult.rescueId);
      setStep('estimate');
    } catch (err: any) {
      setError(err.message || 'Failed to estimate rescue');
    } finally {
      setLoading(false);
    }
  };

  const handleProceedToSign = async () => {
    setError('');
    setLoading(true);

    try {
      if (!estimate) throw new Error('No estimate available');

      // Get signing parameters
      const paramsResult = await apiService.getRescueParams(
        compromisedAddress,
        recipientAddress,
        estimate.tokens.map((t) => t.address)
      );

      setParams(paramsResult);
      setStep('sign');
    } catch (err: any) {
      setError(err.message || 'Failed to get signing parameters');
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async () => {
    setError('');
    setLoading(true);

    try {
      if (!estimate || !params) {
        throw new Error('Missing estimate or parameters');
      }

      // Validate private key
      if (!signingService.isValidPrivateKey(privateKey)) {
        throw new Error('Invalid private key format');
      }

      // Sign transactions in browser
      const signedTransferTxs = await signingService.signTransferTransactions(
        privateKey,
        params,
        estimate.tokens
      );

      // Clear private key from memory immediately
      setPrivateKey('');

      // Note: In production, you'd need the signed funding TX from the sponsor wallet
      // For now, we'll use a placeholder since the server handles funding
      const signedFundingTx = '0x'; // Server will handle this

      setStep('execute');

      // Execute rescue
      const result = await apiService.executeRescue(
        signedFundingTx,
        signedTransferTxs,
        recipientAddress,
        rescueId
      );

      setFundingTxHash(result.fundingTxHash || '');
      setTransferTxHashes(result.transferTxHashes || []);
      setStep('monitor');
    } catch (err: any) {
      setError(err.message || 'Failed to sign and execute rescue');
      setPrivateKey(''); // Clear on error too
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      {step === 'input' && (
        <div className="card">
          <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">
            Step 1: Enter Wallet Details
          </h2>

          {error && (
            <div className="danger-box mb-4">
              <p className="text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Compromised Wallet Address
              </label>
              <input
                type="text"
                value={compromisedAddress}
                onChange={(e) => setCompromisedAddress(e.target.value)}
                placeholder="0x..."
                className="input-field"
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                The wallet that was compromised and holds the tokens
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Recipient Wallet Address (Safe)
              </label>
              <input
                type="text"
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                placeholder="0x..."
                className="input-field"
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Your safe wallet where tokens will be sent
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Token Addresses (comma-separated)
              </label>
              <textarea
                value={tokenAddresses}
                onChange={(e) => setTokenAddresses(e.target.value)}
                placeholder="0x..., 0x..."
                rows={3}
                className="input-field"
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                ERC-20 token contract addresses to rescue
              </p>
            </div>

            <button
              onClick={handleEstimate}
              disabled={loading || !compromisedAddress || !recipientAddress || !tokenAddresses}
              className="btn-primary w-full"
            >
              {loading ? 'Estimating...' : 'Get Rescue Estimate'}
            </button>
          </div>
        </div>
      )}

      {step === 'estimate' && estimate && (
        <div className="card">
          <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">
            Step 2: Review Estimate
          </h2>

          {estimate.warnings.length > 0 && (
            <div className="space-y-2 mb-6">
              {estimate.warnings.map((warning, idx) => (
                <div key={idx} className="warning-box">
                  <p className="text-yellow-700 dark:text-yellow-400">{warning}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-3 text-gray-700 dark:text-gray-300">
              Tokens to Rescue
            </h3>
            <div className="space-y-2">
              {estimate.tokens.map((token, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded"
                >
                  <span className="font-medium">
                    {token.balance} {token.symbol}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{token.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg mb-6">
            <h3 className="font-semibold text-blue-700 dark:text-blue-400 mb-2">
              Service Fee: {estimate.serviceFeePercentage}%
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Charged only on successful rescue. Payment requested after completion.
            </p>
          </div>

          {error && (
            <div className="danger-box mb-4">
              <p className="text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="flex space-x-4">
            <button onClick={() => setStep('input')} className="btn-secondary flex-1">
              Back
            </button>
            <button onClick={handleProceedToSign} disabled={loading} className="btn-primary flex-1">
              {loading ? 'Loading...' : 'Proceed to Signing'}
            </button>
          </div>
        </div>
      )}

      {step === 'sign' && (
        <div className="card">
          <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">
            Step 3: Sign Transactions
          </h2>

          <div className="danger-box mb-6">
            <h3 className="font-bold text-red-700 dark:text-red-400 mb-2">
              🔒 Your Private Key is Safe
            </h3>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Private key is processed in your browser only</li>
              <li>Never sent to our servers</li>
              <li>Cleared from memory immediately after signing</li>
              <li>Make sure you're on a secure device</li>
            </ul>
          </div>

          {error && (
            <div className="danger-box mb-4">
              <p className="text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="mb-6">
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              Compromised Wallet Private Key
            </label>
            <input
              type="password"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="0x... or without 0x prefix"
              className="input-field"
              autoComplete="off"
            />
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Will be used to sign transactions, then immediately cleared
            </p>
          </div>

          <div className="flex space-x-4">
            <button
              onClick={() => {
                setStep('estimate');
                setPrivateKey('');
              }}
              className="btn-secondary flex-1"
            >
              Back
            </button>
            <button onClick={handleSign} disabled={loading || !privateKey} className="btn-primary flex-1">
              {loading ? 'Signing & Executing...' : 'Sign & Execute Rescue'}
            </button>
          </div>
        </div>
      )}

      {step === 'monitor' && (
        <div className="card">
          <h2 className="text-2xl font-bold mb-6 text-center text-green-600 dark:text-green-400">
            ✓ Rescue In Progress
          </h2>

          <div className="success-box mb-6">
            <p className="font-semibold">Transactions submitted successfully!</p>
            <p className="text-sm mt-2">
              Monitoring confirmations... This may take 1-2 minutes.
            </p>
          </div>

          {fundingTxHash && (
            <div className="mb-4">
              <h3 className="font-semibold mb-2 text-gray-700 dark:text-gray-300">Funding Transaction:</h3>
              <a
                href={`https://basescan.org/tx/${fundingTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline break-all"
              >
                {fundingTxHash}
              </a>
            </div>
          )}

          {transferTxHashes.length > 0 && (
            <div className="mb-6">
              <h3 className="font-semibold mb-2 text-gray-700 dark:text-gray-300">Transfer Transactions:</h3>
              <div className="space-y-2">
                {transferTxHashes.map((hash, idx) => (
                  <a
                    key={idx}
                    href={`https://basescan.org/tx/${hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-blue-600 dark:text-blue-400 hover:underline break-all text-sm"
                  >
                    {hash}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="text-center">
            <button onClick={onComplete} className="btn-primary">
              View Status & Payment Info
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
