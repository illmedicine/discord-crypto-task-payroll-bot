# Discord Crypto Payroll Bot

A powerful Discord bot for managing cryptocurrency payroll and payments using Solana blockchain with Phantom wallet integration.

## Features

✨ **Wallet Management**
- Connect Phantom wallet to Discord
- Check SOL balance with USD conversion
- View wallet information

💸 **Direct Payments**
- Send SOL to Discord users
- USD to SOL conversion
- Real-time SOL price fetching

📋 **Task Management**
- Create payroll tasks
- Approve and execute tasks
- View pending tasks
- Transaction history

🔗 **Solana Integration**
- Built on Solana blockchain
- Uses Mainnet-Beta by default
- Secure transaction signing
- Fast & low-cost transfers

## Web UI & API

A browser-based web UI has been added in `../web/` for server admins to create and manage Contests, Tasks, and Events and publish them to Discord channels. The bot now exposes a minimal HTTP API (`server/api.js`) which the web UI uses to:

- Create contests and tasks
- Publish messages to channels
- Read contest/task state and status

Endpoints (local development):

- `GET /api/health` - health check
- `GET /api/contests` - list contests
- `POST /api/contests` - create contest
- `POST /api/publish` - publish a message to a channel

See `../WEB-SETUP.md` for details and deployment instructions.

## Configuration

### Environment Variables
- Built on Solana blockchain
- Uses Mainnet-Beta by default
- Secure transaction signing
- Fast & low-cost transfers

## Installation

### Prerequisites
- Node.js (v16+)
- npm
- Solana wallet with private key
- Discord bot token

### Setup

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/discord-crypto-payroll-bot.git
cd discord-crypto-payroll-bot
```

2. **Install dependencies**
```bash
npm install
```

3. **Create `.env` file**
```bash
cp .env.example .env
```

4. **Configure `.env`**
```
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_app_id
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=your_solana_private_key_base58
SOLANA_PUBLIC_KEY=your_solana_wallet_address
PHANTOM_ENABLED=true
CLUSTER=mainnet-beta
```

5. **Start the bot**
```bash
node index.js
```

## Discord Commands

### `/wallet` - Wallet Management
- **connect** - Connect your Solana wallet
  - `address` - Your Solana wallet address
- **balance** - Check your wallet balance
- **info** - View wallet details

### `/task` - Payroll Tasks
- **create** - Create a new payroll task
  - `recipient` - Recipient Solana address
  - `amount` - Amount in SOL
  - `description` - Task description
- **list** - List all pending tasks
- **info** - Get task details
  - `task_id` - Task ID to view

### `/approve` - Execute Tasks
- Approve and execute a payroll task
  - `task_id` - Task ID to approve

### `/pay` - Direct Payments
- Send SOL to a Discord user
  - `user` - Discord user to pay
  - `amount` - Amount to send
  - `currency` - SOL or USD

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your Discord bot token |
| `DISCORD_CLIENT_ID` | Discord application ID |
| `SOLANA_RPC_URL` | Solana RPC endpoint |
| `SOLANA_PRIVATE_KEY` | Wallet private key (base58) |
| `SOLANA_PUBLIC_KEY` | Wallet public address |
| `PHANTOM_ENABLED` | Enable Phantom integration |
| `CLUSTER` | Solana cluster (mainnet-beta/devnet) |

## Project Structure

```
discord-crypto-payroll-bot/
├── commands/
│   ├── pay.js          # Payment command
│   ├── wallet.js       # Wallet management
│   ├── task-create.js  # Create payroll tasks
│   └── task-approve.js # Approve tasks
├── utils/
│   ├── crypto.js       # Solana interactions
│   └── db.js           # Database operations
├── index.js            # Bot entry point
├── package.json        # Dependencies
└── .env.example        # Environment template
```

## Database

SQLite database (`payroll.db`) with tables:
- `users` - Discord users & wallet addresses
- `tasks` - Payroll tasks
- `transactions` - Transaction history
- `wallet_history` - Wallet connection history

## Security

⚠️ **Important Security Notes:**
- Never commit `.env` file
- Keep private keys secret
- Use environment variables for sensitive data
- Enable 2FA on Discord and crypto wallets
- Test on devnet before mainnet

## Development

### Adding Commands

Create a new file in `commands/` directory:

```javascript
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('command')
    .setDescription('Command description'),
  
  async execute(interaction) {
    await interaction.reply('Response');
  }
};
```

### Testing

Test commands in Discord:
```
/wallet connect [address]
/wallet balance
/pay @user 50 USD
/task create recipient: [address] amount: 1 description: "Test"
```

## Troubleshooting

### Bot not appearing in Discord
- Check bot is invited with correct permissions
- Use correct `DISCORD_CLIENT_ID`
- Leave and rejoin server to refresh

### Commands not working
- Verify `.env` variables are set correctly
- Restart bot after code changes
- Check bot permissions in server

### Transaction failures
- Ensure wallet has sufficient balance
- Check Solana network status
- Verify recipient address is valid

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

MIT License - see LICENSE file for details

## Support

- Create an issue for bugs
- Discuss features in discussions
- Contact: your-email@example.com

## Credits

- Built with [Discord.js](https://discord.js.org/)
- Powered by [Solana](https://solana.com/)
- Integrated with [Phantom Wallet](https://phantom.app/)
- Price data from [CoinGecko](https://coingecko.com/)

## Disclaimer

This bot handles real cryptocurrency. Use at your own risk. Always test with small amounts first. Not responsible for lost funds.

---

**Made with ❤️ for the crypto community**
