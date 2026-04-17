# Deployment Guide - EVM Emergency Service

This guide covers deploying both the backend API and frontend web app for production use.

## Prerequisites

- Node.js 18+ installed
- Git repository access
- Domain name (optional but recommended)
- Funded wallet for sponsor transactions
- Wallet for fee collection

## Quick Start (Local Testing)

### 1. Install Dependencies

```bash
# Root (backend)
npm install

# Frontend
cd web
npm install
cd ..
```

### 2. Configure Environment

```bash
# Backend configuration
cp .env.example .env

# Edit .env with your values:
# - SPONSOR_ADDRESS: Your service wallet address
# - PRIVATE_KEY_SPONSOR: Your service wallet private key
# - SERVICE_WALLET_ADDRESS: Where users send fees
# - SERVICE_FEE_PERCENTAGE: Default 5
```

### 3. Run Locally

**Terminal 1 - Backend:**
```bash
npm run start:api
# API runs on http://localhost:3000
```

**Terminal 2 - Frontend:**
```bash
cd web
npm run dev
# Web app runs on http://localhost:5173
```

Visit http://localhost:5173 to test the application.

---

## Production Deployment

### Option 1: Vercel (Recommended - Easiest)

Vercel provides seamless deployment for both frontend and serverless API.

#### Backend API as Serverless Function

1. **Create `api/` directory in root:**
```bash
mkdir -p api
```

2. **Create `api/index.ts`:**
```typescript
import { createApp } from '../src/api/server';

const app = createApp();

export default app;
```

3. **Create `vercel.json` in root:**
```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/index.ts",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/index.ts"
    }
  ],
  "env": {
    "NODE_ENV": "production"
  }
}
```

4. **Deploy backend:**
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard:
# - SPONSOR_ADDRESS
# - PRIVATE_KEY_SPONSOR
# - SERVICE_WALLET_ADDRESS
# - SERVICE_FEE_PERCENTAGE
# - BASE_RPC_URL
# - BASE_PRIVATE_RPC_URL (optional)
```

#### Frontend Deployment

1. **Navigate to web directory:**
```bash
cd web
```

2. **Configure `VITE_API_URL`:**
Create `.env.production`:
```
VITE_API_URL=https://your-api-domain.vercel.app/api
```

3. **Deploy:**
```bash
vercel --prod
```

4. **Configure custom domain** (optional) in Vercel dashboard

---

### Option 2: Separate Hosting (More Control)

Deploy backend and frontend separately for more flexibility.

#### Backend - Railway / Render

**Railway:**
1. Create new project: https://railway.app
2. Connect GitHub repository
3. Set root directory to `/`
4. Set start command: `npm run start:api`
5. Add environment variables
6. Deploy

**Render:**
1. Create new web service: https://render.com
2. Connect GitHub repository
3. Build command: `npm install && npm run build`
4. Start command: `npm run start:api`
5. Add environment variables
6. Deploy

#### Frontend - Netlify / Cloudflare Pages

**Netlify:**
1. Connect GitHub repository
2. Base directory: `web`
3. Build command: `npm run build`
4. Publish directory: `web/dist`
5. Environment variables:
   - `VITE_API_URL`: Your backend API URL
6. Deploy

**Cloudflare Pages:**
1. Connect GitHub repository
2. Root directory: `web`
3. Build command: `npm run build`
4. Output directory: `dist`
5. Environment variables:
   - `VITE_API_URL`: Your backend API URL
6. Deploy

---

### Option 3: Traditional Server (VPS/Dedicated)

For full control using a VPS (DigitalOcean, AWS EC2, etc.).

#### Backend Setup

1. **Install Node.js and PM2:**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

2. **Clone and build:**
```bash
git clone <your-repo>
cd evm-emergency-service
npm install
npm run build
```

3. **Configure environment:**
```bash
cp .env.example .env
nano .env  # Edit with your values
```

4. **Start with PM2:**
```bash
pm2 start build/api/server.js --name evm-rescue-api
pm2 save
pm2 startup
```

5. **Setup nginx reverse proxy:**
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

6. **Enable HTTPS with Let's Encrypt:**
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

#### Frontend Setup

1. **Build frontend:**
```bash
cd web
npm install
VITE_API_URL=https://api.yourdomain.com/api npm run build
```

2. **Configure nginx:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /var/www/evm-rescue-frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

3. **Copy build files:**
```bash
sudo mkdir -p /var/www/evm-rescue-frontend
sudo cp -r dist/* /var/www/evm-rescue-frontend/
```

4. **Enable HTTPS:**
```bash
sudo certbot --nginx -d yourdomain.com
```

---

## Post-Deployment Checklist

### Security

- [ ] All API endpoints use HTTPS
- [ ] Environment variables properly set
- [ ] Private keys secured (never committed to git)
- [ ] CORS configured to only allow your frontend domain
- [ ] Rate limiting enabled and tested
- [ ] Content Security Policy headers configured

### Testing

- [ ] Test rescue flow end-to-end on testnet
- [ ] Verify transaction signing works
- [ ] Check API error handling
- [ ] Test rate limiting
- [ ] Verify disclaimers display correctly
- [ ] Test on mobile devices

### Monitoring

- [ ] Set up error tracking (Sentry)
- [ ] Configure uptime monitoring
- [ ] Set up log aggregation
- [ ] Monitor sponsor wallet ETH balance
- [ ] Track successful vs failed rescues

### Documentation

- [ ] Update API_URL in frontend docs
- [ ] Document deployment process for your team
- [ ] Create runbook for common issues
- [ ] Document how to access logs

---

## Environment Variables Reference

### Backend (.env)

```bash
# Required
PORT=3000
NODE_ENV=production
SPONSOR_ADDRESS=0x...
PRIVATE_KEY_SPONSOR=0x...
SERVICE_WALLET_ADDRESS=0x...

# Optional
SERVICE_FEE_PERCENTAGE=5
BASE_RPC_URL=https://mainnet.base.org
BASE_PRIVATE_RPC_URL=https://...
CORS_ORIGIN=https://yourdomain.com
```

### Frontend (.env.production)

```bash
VITE_API_URL=https://api.yourdomain.com/api
```

---

## Troubleshooting

### API won't start

1. Check all required environment variables are set
2. Verify sponsor private key is valid
3. Check port 3000 is not in use: `lsof -i :3000`
4. Review logs: `pm2 logs evm-rescue-api`

### Frontend can't connect to API

1. Verify VITE_API_URL is correct
2. Check CORS settings in backend
3. Ensure API is accessible from browser
4. Check browser console for errors

### Transactions failing

1. Verify sponsor wallet has sufficient ETH
2. Check RPC endpoint is responsive
3. Verify gas price estimates are reasonable
4. Check transaction logs on BaseScan

### Rate limiting issues

1. Review rate limit configuration
2. Check if legitimate users are being blocked
3. Consider adjusting limits based on usage
4. Monitor for abuse patterns

---

## Scaling Considerations

### Traffic Growth

- **< 100 requests/day**: Vercel free tier sufficient
- **< 10,000 requests/day**: Vercel Pro or Railway
- **> 10,000 requests/day**: Consider dedicated server with load balancer

### Database (Future)

Currently stateless, but you may want to add:
- PostgreSQL for rescue history
- Redis for caching RPC responses
- MongoDB for analytics

### CDN

For global performance, use:
- Cloudflare for DDoS protection
- CDN for static assets
- Multiple RPC endpoints for redundancy

---

## Cost Estimates

### Vercel (Recommended Start)

- **Frontend**: Free tier (up to 100GB bandwidth)
- **Backend API**: Free tier (100GB-hours, 100 serverless functions)
- **Upgrade**: Pro $20/month when needed

### Traditional VPS

- **DigitalOcean Droplet**: $6-12/month
- **Domain**: $10-15/year
- **SSL**: Free (Let's Encrypt)

### Blockchain Costs

- **Sponsor wallet**: Need ~0.01 ETH per rescue on Base
- **RPC**: Free tier sufficient initially
- **MEV-protected RPC**: Optional, ~$30-100/month

---

## Maintenance

### Regular Tasks

**Weekly:**
- Check sponsor wallet ETH balance
- Review error logs
- Monitor success rates

**Monthly:**
- Update dependencies: `npm audit fix`
- Review and update RPC endpoints
- Check for security advisories

**Quarterly:**
- Review and update gas price strategies
- Analyze rescue success patterns
- Consider fee adjustments based on costs

---

## Support & Updates

- Monitor GitHub issues
- Subscribe to Base network updates
- Join Base developer community
- Keep ethers.js and other dependencies updated

---

## Emergency Procedures

### API Down

1. Check server status: `pm2 status`
2. Review logs: `pm2 logs`
3. Restart if needed: `pm2 restart evm-rescue-api`
4. If persistent, redeploy

### Sponsor Wallet Drained

1. Stop API immediately: `pm2 stop evm-rescue-api`
2. Top up sponsor wallet
3. Restart API
4. Notify active users

### Security Incident

1. Immediately revoke compromised keys
2. Deploy new keys
3. Review all transactions
4. Notify affected users
5. Document incident

---

## Next Steps

After successful deployment:

1. **Test thoroughly** on Base Sepolia testnet
2. **Start with small amounts** on mainnet
3. **Monitor closely** for first 24-48 hours
4. **Gather user feedback** and iterate
5. **Document common issues** for support

Good luck with your deployment! 🚀
