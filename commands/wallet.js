const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('../utils/crypto');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Manage server treasury wallet with Phantom integration')
    .addSubcommand(subcommand =>
      subcommand
        .setName('connect')
        .setDescription('Connect server treasury wallet (only once per server)')
        .addStringOption(option =>
          option.setName('address')
            .setDescription('Server treasury Solana wallet address')
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
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (subcommand === 'connect') {
      await interaction.deferReply();
      console.log(`[wallet] Processing /wallet connect for guild: ${guildId}`);
      try {
        // Check if wallet is already configured for this server
        console.log(`[wallet] Checking for existing wallet...`);
        const existingWallet = await db.getGuildWallet(guildId);
        console.log(`[wallet] Existing wallet check complete:`, existingWallet ? 'wallet found' : 'no wallet');
        
        if (existingWallet) {
          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('🔒 Treasury Wallet Locked')
            .setDescription('This Discord server already has a treasury wallet configured.')
            .addFields(
              { name: 'Configured Wallet', value: `\`${existingWallet.wallet_address}\`` },
              { name: 'Status', value: '🔒 Immutable - Cannot be changed' },
              { name: 'Configured On', value: new Date(existingWallet.configured_at).toLocaleString() },
              { name: 'Note', value: 'The treasury wallet for this server was locked when first configured and cannot be changed.' }
            )
            .setTimestamp();

          return interaction.editReply({
            embeds: [embed]
          });
        }

        const address = interaction.options.getString('address');
        console.log(`[wallet] Validating address: ${address}`);

        // Validate Solana address
        if (!crypto.isValidSolanaAddress(address)) {
          return interaction.editReply({
            content: '❌ Invalid Solana address. Please check and try again.'
          });
        }

        // Set the guild wallet (one-time configuration)
        console.log(`[wallet] Setting guild wallet in database...`);
        await db.setGuildWallet(guildId, address, interaction.user.id);
        console.log(`[wallet] Guild wallet set successfully`);

        const embed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('✅ Treasury Wallet Configured')
          .setDescription('Server treasury wallet has been set and locked.')
          .addFields(
            { name: 'Treasury Address', value: `\`${address}\`` },
            { name: 'Network', value: process.env.CLUSTER || 'mainnet-beta' },
            { name: 'Status', value: '🔒 Locked & Immutable' },
            { name: 'Configured By', value: interaction.user.username },
            { name: 'Important', value: 'This wallet cannot be changed. It is now the permanent treasury for this Discord server.' }
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

    if (subcommand === 'balance') {
      await interaction.deferReply();
      console.log(`[wallet] Processing /wallet balance for guild: ${guildId}`);

      try {
        console.log(`[wallet] Fetching guild wallet...`);
        const guildWallet = await db.getGuildWallet(guildId);
        console.log(`[wallet] Guild wallet fetch complete`, guildWallet);
        
        if (!guildWallet) {
          console.log(`[wallet] No wallet configured for guild ${guildId}`);
          return interaction.editReply({
            content: '❌ No treasury wallet configured for this server. Ask a server admin to configure one with `/wallet connect`.'
          });
        }

        console.log(`[wallet] Fetching balance for: ${guildWallet.wallet_address}`);
        const balance = await crypto.getBalance(guildWallet.wallet_address);
        console.log(`[wallet] Balance fetched: ${balance}`);
        
        const price = await crypto.getSolanaPrice();
        console.log(`[wallet] SOL price fetched: ${price}`);
        
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

        console.log(`[wallet] Sending balance response`);
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
        const guildWallet = await db.getGuildWallet(guildId);
        
        if (!guildWallet) {
          return interaction.editReply({
            content: '❌ No treasury wallet configured for this server.'
          });
        }

        const embed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('📋 Treasury Wallet Information')
          .addFields(
            { name: 'Public Address', value: `\`${guildWallet.wallet_address}\`` },
            { name: 'Network', value: process.env.CLUSTER || 'mainnet-beta' },
            { name: 'Wallet Type', value: 'Server Treasury (Phantom)' },
            { name: 'Status', value: '🔒 Locked & Immutable' },
            { name: 'Configured At', value: new Date(guildWallet.configured_at).toLocaleString() },
            { name: 'RPC Endpoint', value: process.env.SOLANA_RPC_URL || 'api.mainnet-beta.solana.com' },
            { name: 'Purpose', value: 'Permanent treasury for all server payroll & transactions' }
          )
          .setTimestamp();

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
