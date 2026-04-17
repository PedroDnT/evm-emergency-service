import { useState } from 'react';

interface DisclaimerProps {
  onAccept: () => void;
}

export function Disclaimer({ onAccept }: DisclaimerProps) {
  const [accepted, setAccepted] = useState(false);

  const handleAccept = () => {
    if (accepted) {
      onAccept();
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="card">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-red-600 dark:text-red-400 mb-2">
            ⚠️ EMERGENCY RESCUE SERVICE
          </h1>
          <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">
            IMPORTANT DISCLAIMERS - READ CAREFULLY
          </h2>
        </div>

        <div className="space-y-6 text-gray-700 dark:text-gray-300">
          <div className="danger-box">
            <h3 className="font-bold text-lg text-red-700 dark:text-red-400 mb-2">
              1. NO GUARANTEE OF SUCCESS
            </h3>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>This service attempts to rescue tokens from compromised wallets</li>
              <li>Success depends on network conditions and sweeper bot speed</li>
              <li>We cannot guarantee tokens will be recovered</li>
              <li>Sweeper bots may front-run our rescue attempts</li>
            </ul>
          </div>

          <div className="warning-box">
            <h3 className="font-bold text-lg text-yellow-700 dark:text-yellow-400 mb-2">
              2. PRIVATE KEY RISKS
            </h3>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Your compromised wallet private key will be used to sign transactions</li>
              <li>The key is processed IN YOUR BROWSER ONLY and never sent to our servers</li>
              <li>You must ensure your device is secure and not compromised</li>
              <li>
                <strong>NEVER reuse this wallet after the rescue attempt</strong>
              </li>
            </ul>
          </div>

          <div className="warning-box">
            <h3 className="font-bold text-lg text-yellow-700 dark:text-yellow-400 mb-2">
              3. GAS FEES & COSTS
            </h3>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>We provide ETH for gas fees (you don't pay gas upfront)</li>
              <li>Gas will be spent even if rescue fails</li>
              <li>Network congestion may increase costs</li>
              <li>Higher gas prices improve success chances but increase our costs</li>
            </ul>
          </div>

          <div className="success-box">
            <h3 className="font-bold text-lg text-green-700 dark:text-green-400 mb-2">
              4. SERVICE FEE (Only on Success)
            </h3>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>5% fee charged ONLY on successful token rescue</li>
              <li>Fee calculated on rescued token value</li>
              <li>Payment requested after successful rescue</li>
              <li>No fee charged if rescue fails</li>
            </ul>
          </div>

          <div className="danger-box">
            <h3 className="font-bold text-lg text-red-700 dark:text-red-400 mb-2">
              5. NO LIABILITY
            </h3>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Service provided "AS IS" without warranty</li>
              <li>Not responsible for lost funds, failed rescues, or network issues</li>
              <li>
                <strong>User assumes all risks</strong>
              </li>
              <li>This is an emergency service of last resort</li>
            </ul>
          </div>

          <div className="warning-box">
            <h3 className="font-bold text-lg text-yellow-700 dark:text-yellow-400 mb-2">
              6. SWEEPER BOT COMPETITION
            </h3>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Automated bots actively monitor compromised wallets</li>
              <li>They may front-run our rescue attempt</li>
              <li>Success rate varies based on bot sophistication</li>
              <li>We use MEV-protected RPCs to reduce visibility</li>
            </ul>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 p-4 my-4">
            <h3 className="font-bold text-lg text-blue-700 dark:text-blue-400 mb-2">
              💡 IMPORTANT SECURITY NOTES
            </h3>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Your private key is processed client-side in your browser</li>
              <li>We never see or store your private key</li>
              <li>All transactions are signed locally on your device</li>
              <li>After rescue, immediately move tokens to a new secure wallet</li>
            </ul>
          </div>
        </div>

        <div className="mt-8 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 h-5 w-5 text-primary-600 rounded focus:ring-primary-500"
            />
            <span className="text-gray-700 dark:text-gray-300 font-medium">
              I have read and understand all disclaimers above. I accept all risks and agree
              that this service is provided "AS IS" without warranty. I understand that my
              private key will be processed in my browser and never sent to any server.
            </span>
          </label>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={handleAccept}
            disabled={!accepted}
            className="btn-primary text-lg px-12"
          >
            I Accept - Continue to Rescue
          </button>
        </div>

        <p className="mt-6 text-sm text-center text-gray-500 dark:text-gray-400">
          By clicking "I Accept", you acknowledge that you have read, understood, and agree to
          these terms and disclaimers.
        </p>
      </div>
    </div>
  );
}
