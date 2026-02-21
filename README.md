# EVM Emergency Service

A tool for rescuing ERC-20 tokens from compromised wallets. Supports both **Base chain** (primary, via rapid burst submission) and **Ethereum mainnet** (via Flashbots bundles).

## Use Case

When a wallet's private key is compromised, any ETH deposited to cover gas fees will be immediately swept by a monitoring bot before you can transfer tokens out. This tool solves that by:

1. Pre-signing all transactions **before** submitting anything
2. Sending the sponsor funding TX and all token transfer TXs **simultaneously** (burst submission)
3. Optionally broadcasting to a **private/MEV-protected RPC** endpoint in parallel, keeping TXs out of the public mempool until block inclusion
4. **Retrying automatically** with 1.3x gas escalation on failure (up to 3 attempts)

---

## Base Chain Rescue (`npm run start:base`)

### How It Works

```
Sponsor wallet ──(ETH)──► Executor (compromised) ──(token)──► Recipient (safe)
     [TX 1: funding]              [TX 2...N: transfers]
```

All transactions are signed atomically before any submission. The funding TX and transfer TXs are then submitted in rapid succession so the executor wallet has the ETH it needs by the time the transfer is mined. If a sweeper bot claims the gas between attempts, the tool re-signs with fresh nonces and higher fees.

### Submission Strategy

| Approach | Description |
|---|---|
| **Rapid burst (default)** | Submit funding + transfers to public RPC simultaneously |
| **Private RPC (optional)** | Also broadcast to a private/MEV-protected endpoint in parallel |
| **Gas escalation on retry** | Each retry multiplies gas price by 1.3x (capped at 10 gwei) |
| **Nonce staleness guard** | Re-signs transfers if executor nonce moved since signing |

> **Note on private TX on Base**: Base does not support `eth_sendPrivateTransaction` like Flashbots on Ethereum mainnet. "Private submission" on Base means broadcasting to a dedicated RPC node that withholds TXs from the public mempool until block inclusion. This reduces (but does not eliminate) sweeper visibility. Recommended providers: [dRPC MEV endpoint](https://drpc.org/chainlist/base) (premium), [Chainstack](https://chainstack.com/build-better-with-base/), [1RPC](https://www.1rpc.io/ecosystem/base).

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PRIVATE_KEY_EXECUTOR` | Yes | — | Private key of the compromised wallet holding tokens |
| `PRIVATE_KEY_SPONSOR` | Yes | — | Private key of a safe wallet with ETH to pay gas |
| `RECIPIENT` | Yes | — | Safe address to receive rescued tokens |
| `TOKEN_ADDRESSES` | No | RNBW | Comma-separated ERC-20 addresses to rescue |
| `TOKEN_ADDRESS` | No | RNBW | Single ERC-20 address (alias for single-token use) |
| `BASE_RPC_URL` | No | `https://mainnet.base.org` | Primary Base RPC endpoint |
| `BASE_PRIVATE_RPC_URL` | No | — | MEV-protected RPC for parallel broadcast |
| `PRIORITY_FEE_GWEI` | No | `0.5` | EIP-1559 priority fee (tip) in gwei |
| `MAX_FEE_GWEI` | No | `2` | Maximum fee per gas in gwei |

### Usage

**Single token:**
```bash
npm install

PRIVATE_KEY_EXECUTOR=<compromised_key> \
PRIVATE_KEY_SPONSOR=<funded_key> \
RECIPIENT=<safe_address> \
TOKEN_ADDRESS=0xYourToken \
  npm run start:base
```

**Multiple tokens at once:**
```bash
PRIVATE_KEY_EXECUTOR=<compromised_key> \
PRIVATE_KEY_SPONSOR=<funded_key> \
RECIPIENT=<safe_address> \
TOKEN_ADDRESSES=0xToken1,0xToken2,0xToken3 \
  npm run start:base
```

**With private RPC for reduced sweeper exposure:**
```bash
PRIVATE_KEY_EXECUTOR=<compromised_key> \
PRIVATE_KEY_SPONSOR=<funded_key> \
RECIPIENT=<safe_address> \
TOKEN_ADDRESS=0xYourToken \
BASE_PRIVATE_RPC_URL=https://your-private-rpc-endpoint/base \
  npm run start:base
```

**With aggressive gas (if default fails against a fast sweeper):**
```bash
PRIVATE_KEY_EXECUTOR=<compromised_key> \
PRIVATE_KEY_SPONSOR=<funded_key> \
RECIPIENT=<safe_address> \
TOKEN_ADDRESS=0xYourToken \
PRIORITY_FEE_GWEI=2 \
MAX_FEE_GWEI=5 \
  npm run start:base
```

### Retry Behavior

| Attempt | Gas multiplier | Notes |
|---|---|---|
| 1 | 1.0x (base) | Original gas price |
| 2 | 1.3x | Fresh nonces, escalated gas |
| 3 | 1.69x | Fresh nonces, escalated gas, max 10 gwei cap |

If the funding TX confirmed but transfers failed, the tool skips re-funding and re-submits transfers only with a fresh nonce and escalated gas.

### EIP-7702 Delegation Warning

If the compromised wallet has contract code (EIP-7702 delegation), the tool will warn you. A delegated `receive()` function may intercept incoming ETH. In this case:
- The tool still attempts the rescue with a higher funding gas limit (100k)
- Check the delegation first and revoke it if possible.

---

## Ethereum Mainnet Rescue (`npm run start`)

Original Flashbots bundle submission for Ethereum mainnet. Uses atomic bundle guarantees — transactions either all land in the same block or none do.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PRIVATE_KEY_EXECUTOR` | Yes | Compromised wallet private key |
| `PRIVATE_KEY_SPONSOR` | Yes | Safe wallet with ETH for gas |
| `RECIPIENT` | Yes | Address to receive assets |
| `FLASHBOTS_RELAY_SIGNING_KEY` | Yes | Key to sign Flashbots RPC requests (establishes reputation) |
| `ETHEREUM_RPC_URL` | Yes | Ethereum RPC endpoint (cannot be Flashbots RPC) |

### Usage

```bash
npm install

PRIVATE_KEY_EXECUTOR=<compromised_key> \
PRIVATE_KEY_SPONSOR=<funded_key> \
RECIPIENT=<safe_address> \
FLASHBOTS_RELAY_SIGNING_KEY=<signing_key> \
ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY \
  npm run start
```

Engines (configured inside `src/index.ts`):
- `TransferERC20` — transfer an ERC-20 token
- `Approval721` — set ERC-721 approvals
- `CryptoKitties` — CryptoKitties-specific transfers

---

---

## Environment Variables Storage

Store environment variables in a `.env` file (not committed to git) at the project root, or export them directly in your shell:

**Option 1: `.env` file (recommended)**
```
PRIVATE_KEY_EXECUTOR=your_compromised_key_here
PRIVATE_KEY_SPONSOR=your_safe_key_here
RECIPIENT=0x...
TOKEN_ADDRESS=0x...
```

**Option 2: Export in shell**
```bash
export PRIVATE_KEY_EXECUTOR=your_compromised_key_here
export PRIVATE_KEY_SPONSOR=your_safe_key_here
# then run: npm run start:base
```

> **Important**: Add `.env` to `.gitignore` to prevent accidentally committing private keys.

---

## Security Notes

- Private keys are only read from environment variables, never stored
- The sponsor wallet only needs enough ETH to cover gas (~0.0001 ETH on Base at normal fees)
- The executor wallet private key must be provided to sign transfer transactions — treat this operation as a one-time emergency procedure
- After a successful rescue, consider the executor wallet permanently compromised and do not reuse it

"scripts": {
  "test": "jest",
  "test:watch": "jest --watch"
}
