# EVM Emergency Service - Web Frontend

React-based web interface for the EVM Emergency Service.

## Features

- **Client-side transaction signing** - Private keys never leave the user's browser
- **Step-by-step wizard** - Guides users through the rescue process
- **Comprehensive disclaimers** - Clear risk communication
- **Real-time monitoring** - Track transaction status
- **Responsive design** - Works on desktop and mobile
- **Dark mode support** - Automatic theme detection

## Tech Stack

- **React 18** with TypeScript
- **Vite** for fast development and building
- **TailwindCSS** for styling
- **ethers.js** for blockchain interactions
- **RainbowKit** for wallet connections (optional enhancement)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
cd web
npm install
```

### Development

Start the development server (runs on http://localhost:5173):

```bash
npm run dev
```

The dev server includes a proxy to the API backend at http://localhost:3000.

### Building for Production

```bash
npm run build
```

Output is in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## Environment Variables

Create a `.env` file (optional):

```bash
# API endpoint (defaults to /api in development via proxy)
VITE_API_URL=https://api.yourdomain.com/api
```

## Project Structure

```
web/
├── src/
│   ├── components/
│   │   ├── Disclaimer.tsx        # Risk disclaimers & acceptance
│   │   └── RescueWizard.tsx      # Main rescue flow
│   ├── services/
│   │   ├── api.service.ts        # Backend API client
│   │   └── signing.service.ts    # Transaction signing
│   ├── types.ts                  # TypeScript interfaces
│   ├── App.tsx                   # Root component
│   ├── main.tsx                  # Entry point
│   └── index.css                 # Global styles
├── public/                       # Static assets
├── index.html                    # HTML template
├── vite.config.ts                # Vite configuration
├── tailwind.config.js            # Tailwind configuration
└── package.json
```

## User Flow

1. **Disclaimer** - User reads and accepts risk disclaimers
2. **Input** - User enters compromised wallet, recipient wallet, and token addresses
3. **Estimate** - System fetches token balances and calculates fees
4. **Sign** - User enters private key to sign transactions locally
5. **Execute** - Signed transactions broadcast to network
6. **Monitor** - Real-time status updates with transaction links

## Security Features

### Client-Side Signing

The most critical security feature is **client-side transaction signing**:

1. User enters private key in browser
2. Transactions signed locally using ethers.js
3. Private key cleared from memory immediately
4. Only signed transactions sent to server
5. Server never sees the private key

### Implementation

```typescript
// Private key is used locally
const wallet = new Wallet(privateKey);
const signedTx = await wallet.signTransaction(txParams);

// Clear immediately
privateKey = '';

// Send only signed transaction
await apiService.executeRescue(signedTx, ...);
```

### Additional Security

- Input validation on all addresses
- HTTPS enforcement (in production)
- No localStorage/sessionStorage of sensitive data
- Clear warnings about compromised wallet reuse
- Automatic theme to prevent screen burn-in of private keys

## Deployment

### Vercel (Recommended)

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
cd web
vercel --prod
```

3. Set environment variables in Vercel dashboard:
   - `VITE_API_URL` - Your API endpoint

### Netlify

1. Build command: `npm run build`
2. Publish directory: `dist`
3. Set environment variables in Netlify dashboard

### Traditional Hosting

Build the app and serve the `dist` directory:

```bash
npm run build
# Serve dist/ with nginx, apache, etc.
```

Example nginx configuration:

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /path/to/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Future Enhancements

### Short Term
- Add loading animations
- Improve mobile responsiveness
- Add transaction status polling
- Show estimated time to confirmation

### Medium Term
- Wallet connection via MetaMask/WalletConnect
- Multi-language support
- Email notifications
- Rescue history (with user accounts)

### Long Term
- Support for NFT rescue
- Multi-chain support UI
- Advanced gas estimation
- Batch rescue operations

## Development Tips

### Hot Reload

The dev server supports hot module replacement (HMR). Changes to React components will update instantly.

### Type Checking

Run TypeScript type checking:

```bash
npm run build
```

### Linting

Run ESLint:

```bash
npm run lint
```

### Styling

Uses TailwindCSS utility classes. Customize theme in `tailwind.config.js`.

Common utilities:
- `btn-primary` - Primary button style
- `btn-secondary` - Secondary button style
- `input-field` - Input field style
- `card` - Card container
- `warning-box` - Warning message box
- `danger-box` - Danger message box
- `success-box` - Success message box

## Troubleshooting

### API Connection Issues

If the frontend can't connect to the API:

1. Check API is running on port 3000
2. Verify proxy configuration in `vite.config.ts`
3. Check CORS settings in API server
4. Try setting `VITE_API_URL` explicitly

### Build Errors

If build fails:

1. Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
2. Clear Vite cache: `rm -rf node_modules/.vite`
3. Check TypeScript errors: `npm run build`

### Transaction Signing Errors

If signing fails:

1. Verify private key format (64 hex characters)
2. Check that address matches private key
3. Ensure ethers.js is properly installed
4. Check browser console for detailed errors

## Support

For issues or questions, please open an issue on GitHub.

## License

ISC
