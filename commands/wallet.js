const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('../utils/crypto');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Manage your Solana wallet with Phantom integration')
    .addSubcommand(subcommand =>
      subcommand
        .setName('connect')
        .setDescription('Connect your Phantom wallet')
        .addStringOption(option =>
          option.setName('address')
            .setDescription('Your Solana wallet address')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('balance')
        .setDescription('Check your wallet balance')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('View your wallet information')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'connect') {
      const address = interaction.options.getString('address');

      // Validate Solana address
      if (!crypto.isValidSolanaAddress(address)) {
        return interaction.reply({
          content: '❌ Invalid Solana address. Please check and try again.',
          ephemeral: true
        });
      }

      // Here you would store the wallet address in your database
      // For now, just confirm the connection
      const embed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle('✅ Wallet Connected')
        .setDescription(`Successfully connected to Phantom wallet`)
        .addFields(
          { name: 'Wallet Address', value: `\`${address}\`` },
          { name: 'Network', value: process.env.CLUSTER || 'mainnet-beta' },
          { name: 'Status', value: '🟢 Connected' }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'balance') {
      await interaction.deferReply();

      try {
        // In production, get the user's stored wallet address from database
        // For now, use the bot's wallet
        const wallet = crypto.getWallet();
        if (!wallet) {
          return interaction.editReply('❌ Wallet not configured.');
        }

        const balance = await crypto.getBalance(wallet.publicKey.toString());
        const price = await crypto.getSolanaPrice();
        const usdValue = price ? (balance * price).toFixed(2) : 'N/A';

        const embed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('💰 Wallet Balance')
          .addFields(
            { name: 'SOL Balance', value: `${balance.toFixed(4)} SOL` },
            { name: 'USD Value', value: `$${usdValue}` },
            { name: 'Address', value: `\`${wallet.publicKey.toString()}\`` }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        return interaction.editReply(`❌ Error fetching balance: ${error.message}`);
      }
    }

    if (subcommand === 'info') {
      const wallet = crypto.getWallet();
      if (!wallet) {
        return interaction.reply('❌ Wallet not configured.');
      }

      const embed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle('📋 Wallet Information')
        .addFields(
          { name: 'Public Address', value: `\`${wallet.publicKey.toString()}\`` },
          { name: 'Network', value: process.env.CLUSTER || 'mainnet-beta' },
          { name: 'Wallet Type', value: 'Phantom (Solana)' },
          { name: 'RPC Endpoint', value: process.env.SOLANA_RPC_URL || 'api.mainnet-beta.solana.com' }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }
  }
};
