# EVM Emergency Service - Web API

A REST API for rescuing tokens from compromised wallets on Base chain.

## Overview

This API enables a web-based interface for the EVM Emergency Service. Users can estimate rescue costs, sign transactions client-side, and broadcast them through our service with MEV protection.

## Architecture

The API follows a **client-side signing** model for maximum security:

1. User provides compromised wallet address (not private key initially)
2. API returns signing parameters (nonces, gas estimates, token info)
3. User signs transactions in their browser (private key never sent to server)
4. User sends pre-signed transactions to API for broadcasting
5. API broadcasts to public + private RPCs simultaneously
6. API monitors transaction status

## Setup

### Prerequisites

- Node.js 14+
- npm or yarn
- A funded wallet for sponsor (provides gas for rescue operations)
- A wallet address for fee collection

### Installation

```bash
npm install
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required environment variables:
- `SPONSOR_ADDRESS` - Address of your sponsor wallet
- `PRIVATE_KEY_SPONSOR` - Private key of sponsor wallet (server-side only)
- `SERVICE_WALLET_ADDRESS` - Address where users send fees
- `SERVICE_FEE_PERCENTAGE` - Default: 5

### Running the Server

Development:
```bash
npm run dev:api
```

Production:
```bash
npm run start:api
```

The API will start on `http://localhost:3000` by default.

## API Endpoints

### Health Check

**GET** `/api/health`

Check if the API is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1234567890
}
```

---

### Estimate Rescue

**POST** `/api/rescue/estimate`

Get token information and cost estimates for a rescue operation.

**Request Body:**
```json
{
  "executorAddress": "0x...",
  "recipientAddress": "0x...",
  "tokenAddresses": ["0x...", "0x..."]
}
```

**Response:**
```json
{
  "tokens": [
    {
      "address": "0x...",
      "symbol": "USDC",
      "name": "USD Coin",
      "balance": "1000.0",
      "decimals": 6
    }
  ],
  "estimatedGasCost": "65000",
  "serviceFeePercentage": 5,
  "warnings": [
    "WARNING: Executor wallet has contract code..."
  ],
  "rescueId": "abc123..."
}
```

---

### Get Signing Parameters

**POST** `/api/rescue/params`

Get detailed parameters needed for client-side transaction signing.

**Request Body:**
```json
{
  "executorAddress": "0x...",
  "recipientAddress": "0x...",
  "tokenAddresses": ["0x..."]
}
```

**Response:**
```json
{
  "executorAddress": "0x...",
  "recipientAddress": "0x...",
  "tokenAddresses": ["0x..."],
  "nonces": {
    "executor": 5,
    "sponsor": 10
  },
  "gasEstimates": {
    "maxFeePerGas": "2000000000",
    "maxPriorityFeePerGas": "500000000",
    "totalGasLimit": "65000"
  },
  "chainId": 8453
}
```

---

### Execute Rescue

**POST** `/api/rescue/execute`

Broadcast pre-signed transactions to the network.

**Request Body:**
```json
{
  "signedFundingTx": "0x...",
  "signedTransferTxs": ["0x...", "0x..."],
  "recipientAddress": "0x...",
  "rescueId": "abc123..."
}
```

**Response:**
```json
{
  "rescueId": "abc123...",
  "status": "pending",
  "fundingTxHash": "0x...",
  "transferTxHashes": ["0x...", "0x..."]
}
```

---

### Get Rescue Status

**GET** `/api/rescue/status/:rescueId`

Check the status of a rescue operation.

**Response:**
```json
{
  "rescueId": "abc123...",
  "status": "success",
  "fundingTxHash": "0x...",
  "transferTxHashes": ["0x..."],
  "confirmations": 3
}
```

Status values:
- `pending` - Transactions submitted, waiting for confirmation
- `success` - All transactions confirmed successfully
- `failed` - One or more transactions failed

---

## Rate Limiting

- General API calls: 30 requests per minute per IP
- Rescue operations: 5 attempts per 15 minutes per IP

## Security Features

1. **Client-side signing** - Private keys never sent to server
2. **Rate limiting** - Prevents abuse
3. **CORS protection** - Configurable allowed origins
4. **Helmet security headers** - XSS and other protections
5. **Input validation** - All addresses and parameters validated

## Error Handling

All errors return JSON with an `error` field:

```json
{
  "error": "Error message here"
}
```

Common HTTP status codes:
- `400` - Bad request (invalid input)
- `404` - Resource not found
- `429` - Rate limit exceeded
- `500` - Internal server error

## Client-Side Signing Example

The frontend must sign transactions using ethers.js:

```typescript
import { Wallet, utils } from 'ethers';

// Get signing parameters from API
const params = await fetch('/api/rescue/params', {
  method: 'POST',
  body: JSON.stringify({
    executorAddress,
    recipientAddress,
    tokenAddresses
  })
}).then(r => r.json());

// Sign funding transaction (sponsor wallet - handled by service in practice)
// Sign transfer transactions (user's compromised wallet)
const executorWallet = new Wallet(compromisedPrivateKey);

const signedTransferTxs = [];
for (let i = 0; i < params.tokenAddresses.length; i++) {
  const contract = new Contract(params.tokenAddresses[i], ERC20_ABI, provider);
  const balance = await contract.balanceOf(params.executorAddress);

  const tx = await executorWallet.signTransaction({
    to: params.tokenAddresses[i],
    data: contract.interface.encodeFunctionData('transfer', [
      params.recipientAddress,
      balance
    ]),
    gasLimit: estimatedGasLimit,
    maxFeePerGas: params.gasEstimates.maxFeePerGas,
    maxPriorityFeePerGas: params.gasEstimates.maxPriorityFeePerGas,
    nonce: params.nonces.executor + i,
    value: 0,
    type: 2,
    chainId: params.chainId
  });

  signedTransferTxs.push(tx);
}

// Execute rescue
await fetch('/api/rescue/execute', {
  method: 'POST',
  body: JSON.stringify({
    signedFundingTx,
    signedTransferTxs,
    recipientAddress,
    rescueId
  })
});
```

## Deployment

### Vercel (Recommended)

1. Install Vercel CLI: `npm i -g vercel`
2. Configure environment variables in Vercel dashboard
3. Deploy: `vercel --prod`

### Docker

```dockerfile
FROM node:14
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start:api"]
```

### Traditional Server

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start with PM2
pm2 start build/api/server.js --name evm-rescue-api
```

## Monitoring

Consider adding:
- Sentry for error tracking
- LogRocket for session replay
- Custom metrics for rescue success rate
- Blockchain event monitoring for fee payments

## Support

For issues or questions, please open an issue on GitHub.
