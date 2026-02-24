# Railway Deployment Guide

## Prerequisites
- GitHub account
- Railway account (sign up at https://railway.app)
- This bot code pushed to a GitHub repository

## Deployment Steps

### 1. Push Code to GitHub
```bash
git init
git add .
git commit -m "Initial commit - Discord crypto bot"
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### 2. Deploy to Railway

1. Go to https://railway.app and sign in
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository
5. Railway will automatically detect it's a Node.js project

### 3. Configure Environment Variables

In Railway project settings, add these environment variables:

```
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=your_solana_private_key
SOLANA_PUBLIC_KEY=your_solana_wallet_public_address
PHANTOM_ENABLED=true
CLUSTER=mainnet-beta
ENCRYPTION_KEY=your_64_hex_char_key
E2E_TRANSPORT_KEY=optional_64_hex_char_key
```

**Important**: Never commit your `.env` file to GitHub!

### 4. Deploy

Railway will automatically:
- Install dependencies
- Start your bot using the `start` script
- Keep it running 24/7

### 5. Monitor Your Bot

- View logs in the Railway dashboard
- Check bot status in Discord
- Railway provides metrics and monitoring

## Pricing

- **Free tier**: $5 in credits per month (usually enough for a small bot)
- **After credits**: ~$5/month for continuous operation
- **Pay only for usage**: Scales with your needs

## Troubleshooting

If the bot doesn't start:
1. Check Railway logs for errors
2. Verify all environment variables are set correctly
3. Ensure your Discord token is valid
4. Check that your Solana wallet private key is correct

## Updating Your Bot

To deploy updates:
```bash
git add .
git commit -m "Your update message"
git push
```

Railway will automatically redeploy with the new changes.
