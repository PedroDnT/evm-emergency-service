import { useState } from 'react';
import { Disclaimer } from './components/Disclaimer';
import { RescueWizard } from './components/RescueWizard';
import './index.css';

function App() {
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [rescueComplete, setRescueComplete] = useState(false);

  if (!disclaimerAccepted) {
    return <Disclaimer onAccept={() => setDisclaimerAccepted(true)} />;
  }

  if (rescueComplete) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="card text-center">
          <h1 className="text-3xl font-bold text-green-600 dark:text-green-400 mb-4">
            🎉 Rescue Process Complete!
          </h1>
          <p className="text-lg mb-6 text-gray-700 dark:text-gray-300">
            Please check the transaction status on BaseScan.
          </p>
          <div className="success-box text-left mb-6">
            <h3 className="font-bold text-lg mb-2">Next Steps:</h3>
            <ol className="list-decimal list-inside space-y-2">
              <li>Verify all transactions are confirmed on BaseScan</li>
              <li>Move rescued tokens from recipient wallet to a new secure wallet immediately</li>
              <li>If rescue was successful, you'll be contacted for the 5% service fee payment</li>
              <li>Never use the compromised wallet again</li>
            </ol>
          </div>
          <button onClick={() => window.location.reload()} className="btn-primary">
            Start New Rescue
          </button>
        </div>
      </div>
    );
  }

  return <RescueWizard onComplete={() => setRescueComplete(true)} />;
}

export default App;
