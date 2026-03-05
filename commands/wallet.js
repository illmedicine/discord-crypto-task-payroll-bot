const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('../utils/crypto');
const db = require('../utils/db');
const { syncWalletToBackend, getGuildWalletWithFallback } = require('../utils/walletSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Manage server treasury wallet with Phantom integration')
    .addSubcommand(subcommand =>
      subcommand
        .setName('connect')
        .setDescription('Connect server treasury wallet (Server Owner only, once per server)')
        .addStringOption(option =>
          option.setName('address')
            .setDescription('Server treasury Solana wallet address')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('secret')
            .setDescription('Base58 private key for auto-payouts (AES-256-GCM encrypted at rest, never shown)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-key')
        .setDescription('Add or update the treasury wallet private key (Server Owner only)')
        .addStringOption(option =>
          option.setName('secret')
            .setDescription('Base58 private key for auto-payouts (AES-256-GCM encrypted at rest, never shown)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('balance')
        .setDescription('Check treasury wallet balance')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('View treasury wallet information')
    ),

  async execute(interaction) {
    console.error(`[WALLET] Command started: ${interaction.options.getSubcommand()}`);
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (subcommand === 'connect') {
      await interaction.deferReply();
      try {
        // Check if user is the server owner
        let guild = interaction.guild;
        if (!guild) {
          try {
            guild = await interaction.client.guilds.fetch(guildId);
          } catch (e) {
            console.error(`[WALLET] Could not fetch guild ${guildId}:`, e.message);
            const botId = interaction.client.user.id;
            const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${botId}&scope=bot+applications.commands&permissions=8`;
            return interaction.editReply({
              content: `❌ DisCryptoBank is not a full member of this server.\n\n` +
                `The bot needs to be re-invited with both **bot** and **applications.commands** scopes.\n` +
                `👉 [Re-invite DisCryptoBank](${inviteUrl})`
            });
          }
        }
        if (interaction.user.id !== guild.ownerId) {
          return interaction.editReply({
            content: '❌ Only the **Server Owner** can connect the treasury wallet for this server.'
          });
        }

        console.error(`[WALLET] Connect: Getting existing wallet...`);
        // Check if wallet is already configured (local + backend)
        const existingWallet = await getGuildWalletWithFallback(guildId);
        console.error(`[WALLET] Connect: Got wallet result`);
        
        if (existingWallet) {
          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('🔒 Treasury Wallet Already Configured')
            .setDescription('This Discord server already has a treasury wallet connected.')
            .addFields(
              { name: 'Configured Wallet', value: `\`${existingWallet.wallet_address}\`` },
              { name: 'Status', value: '🔒 Locked via Discord' },
              { name: 'Configured On', value: new Date(existingWallet.configured_at).toLocaleString() },
              { name: 'Add Private Key?', value: 'Use `/wallet set-key` to add or update the private key for auto-payouts.' },
              { name: 'Need to change wallet?', value: 'Server owners can disconnect and reconnect the wallet from **[DCB Event Manager](https://illmedicine.github.io/discord-crypto-task-payroll-bot/)**.' }
            )
            .setTimestamp();

          console.error(`[WALLET] Connect: Sending existing wallet response`);
          return interaction.editReply({
            embeds: [embed]
          });
        }

        const address = interaction.options.getString('address');
        const secretKey = interaction.options.getString('secret');

        // Validate Solana address
        if (!crypto.isValidSolanaAddress(address)) {
          return interaction.editReply({
            content: '❌ Invalid Solana address. Please check and try again.'
          });
        }

        // If secret key provided, validate it derives the correct address
        if (secretKey) {
          const keypair = crypto.getKeypairFromSecret(secretKey);
          if (!keypair) {
            return interaction.editReply({
              content: '❌ Invalid private key format. Must be a base58-encoded Solana secret key.'
            });
          }
          if (keypair.publicKey.toString() !== address) {
            return interaction.editReply({
              content: `❌ Private key does not match the wallet address.\n\n` +
                `**Address provided:** \`${address}\`\n` +
                `**Key derives:** \`${keypair.publicKey.toString()}\`\n\n` +
                `Please provide the correct private key for this wallet, or use the derived address.`
            });
          }
        }

        // Set the guild wallet
        console.error(`[WALLET] Connect: Setting new wallet...`);
        await db.setGuildWallet(guildId, address, interaction.user.id, 'Treasury', process.env.CLUSTER || 'mainnet-beta', secretKey || null);
        console.error(`[WALLET] Connect: Wallet set, syncing to backend...`);

        // Sync to backend (DCB Event Manager will see this wallet)
        syncWalletToBackend({
          guildId,
          action: 'connect',
          wallet_address: address,
          wallet_secret: secretKey || null,
          label: 'Treasury',
          network: process.env.CLUSTER || 'mainnet-beta',
          configured_by: interaction.user.id
        });

        const hasSecret = !!secretKey;
        const embed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('✅ Treasury Wallet Configured')
          .setDescription('Server treasury wallet has been connected and synced to [DCB Event Manager](https://illmedicine.github.io/discord-crypto-task-payroll-bot/).')
          .addFields(
            { name: 'Treasury Address', value: `\`${address}\`` },
            { name: 'Network', value: process.env.CLUSTER || 'mainnet-beta' },
            { name: 'Auto-Payouts', value: hasSecret ? '✅ Enabled — payments will be sent from this wallet automatically' : '❌ Disabled — provide the wallet private key to enable auto-payouts' },
            { name: 'Status', value: '🔒 Connected' },
            { name: 'Configured By', value: interaction.user.username },
            { name: 'Manage', value: 'Use **[DCB Event Manager](https://illmedicine.github.io/discord-crypto-task-payroll-bot/)** to update or disconnect the wallet.' }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Wallet connect error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }

    if (subcommand === 'set-key') {
      await interaction.deferReply({ ephemeral: true });
      try {
        // Check if user is the server owner
        let guild = interaction.guild;
        if (!guild) {
          try {
            guild = await interaction.client.guilds.fetch(guildId);
          } catch (e) {
            console.error(`[WALLET] Could not fetch guild ${guildId}:`, e.message);
            return interaction.editReply({ content: '❌ Could not verify server ownership.' });
          }
        }
        if (interaction.user.id !== guild.ownerId) {
          return interaction.editReply({ content: '❌ Only the **Server Owner** can update the treasury wallet private key.' });
        }

        // Check if wallet exists
        const existingWallet = await getGuildWalletWithFallback(guildId);
        if (!existingWallet) {
          return interaction.editReply({ content: '❌ No treasury wallet configured. Use `/wallet connect` first.' });
        }

        const secretKey = interaction.options.getString('secret');

        // Validate the private key
        let keypair;
        try {
          keypair = crypto.getKeypairFromSecret(secretKey);
        } catch (err) {
          return interaction.editReply({ content: '❌ Invalid private key format. Must be a base58-encoded Solana secret key.' });
        }
        if (!keypair) {
          return interaction.editReply({ content: '❌ Invalid private key format. Must be a base58-encoded Solana secret key.' });
        }

        // Verify the key matches the connected wallet address
        if (keypair.publicKey.toString() !== existingWallet.wallet_address) {
          return interaction.editReply({
            content: `❌ Private key does not match the treasury wallet address.\n\n` +
              `**Treasury address:** \`${existingWallet.wallet_address}\`\n` +
              `**Key derives:** \`${keypair.publicKey.toString()}\`\n\n` +
              `Please provide the correct private key for the treasury wallet.`
          });
        }

        // Save the key
        await db.setGuildWalletSecret(guildId, secretKey);
        console.log(`[WALLET] set-key: Private key updated for guild ${guildId} by ${interaction.user.id}`);

        // Sync to backend
        syncWalletToBackend({
          guildId,
          action: 'update-key',
          wallet_address: existingWallet.wallet_address,
          wallet_secret: secretKey,
          label: existingWallet.label || 'Treasury',
          network: existingWallet.network || process.env.CLUSTER || 'mainnet-beta',
          configured_by: interaction.user.id
        });

        const embed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('\u2705 Treasury Private Key Updated')
          .setDescription('The private key for the treasury wallet has been saved and synced.')
          .addFields(
            { name: 'Treasury Address', value: `\`${existingWallet.wallet_address}\`` },
            { name: 'Auto-Payouts', value: '\u2705 Enabled — payments will be sent from this wallet automatically' },
            { name: 'Security', value: '\uD83D\uDD12 AES-256-GCM encrypted at rest, never displayed' }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Wallet set-key error:', error);
        return interaction.editReply({ content: `❌ Error: ${error.message}` });
      }
    }

    if (subcommand === 'balance') {
      await interaction.deferReply();

      try {
        console.error(`[WALLET] Balance: Getting guild wallet...`);
        const guildWallet = await getGuildWalletWithFallback(guildId);
        console.error(`[WALLET] Balance: Got wallet, now fetching balance...`);
        
        if (!guildWallet) {
          return interaction.editReply({
            content: '❌ No treasury wallet configured for this server. Ask the **Server Owner** to configure one with `/wallet connect` or via **[DCB Event Manager](https://illmedicine.github.io/discord-crypto-task-payroll-bot/)**.'
          });
        }

        console.error(`[WALLET] Balance: Fetching balance and price...`);
        const balance = await crypto.getBalance(guildWallet.wallet_address);
        const price = await crypto.getSolanaPrice();
        console.error(`[WALLET] Balance: Got balance ${balance}, price ${price}`);
        const usdValue = price ? (balance * price).toFixed(2) : 'N/A';

        const embed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('💰 Treasury Wallet Balance')
          .addFields(
            { name: 'SOL Balance', value: `${balance.toFixed(4)} SOL` },
            { name: 'USD Value', value: `$${usdValue}` },
            { name: 'Address', value: `\`${guildWallet.wallet_address}\`` },
            { name: 'Server Treasury', value: `Locked & Managed` }
          )
          .setTimestamp();

        console.error(`[WALLET] Balance: Sending response`);
        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Wallet balance error:', error);
        return interaction.editReply({
          content: `❌ Error fetching balance: ${error.message}`
        });
      }
    }

    if (subcommand === 'info') {
      await interaction.deferReply();
      try {
        console.error(`[WALLET] Info: Getting guild wallet...`);
        const guildWallet = await getGuildWalletWithFallback(guildId);
        console.error(`[WALLET] Info: Got wallet result`);
        
        if (!guildWallet) {
          return interaction.editReply({
            content: '❌ No treasury wallet configured for this server. Use `/wallet connect` or **[DCB Event Manager](https://illmedicine.github.io/discord-crypto-task-payroll-bot/)** to set one up.'
          });
        }

        const embed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('📋 Treasury Wallet Information')
          .addFields(
            { name: 'Public Address', value: `\`${guildWallet.wallet_address}\`` },
            { name: 'Network', value: process.env.CLUSTER || 'mainnet-beta' },
            { name: 'Wallet Type', value: 'Server Treasury (Phantom)' },
            { name: 'Status', value: '🔒 Connected' },
            { name: 'Manage', value: 'Use **[DCB Event Manager](https://illmedicine.github.io/discord-crypto-task-payroll-bot/)** to update or disconnect' },
            { name: 'Configured At', value: new Date(guildWallet.configured_at).toLocaleString() },
            { name: 'RPC Endpoint', value: process.env.SOLANA_RPC_URL || 'api.mainnet-beta.solana.com' },
            { name: 'Purpose', value: 'Permanent treasury for all server payroll & transactions' }
          )
          .setTimestamp();

        console.error(`[WALLET] Info: Sending response`);
        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Wallet info error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }
  }
};
