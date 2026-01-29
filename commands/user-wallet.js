const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('../utils/crypto');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('user-wallet')
    .setDescription('Connect your personal Solana wallet (works on all servers)')
    .addSubcommand(subcommand =>
      subcommand
        .setName('connect')
        .setDescription('Connect your personal Solana wallet address')
        .addStringOption(option =>
          option.setName('address')
            .setDescription('Your personal Solana wallet address')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View your connected wallet address')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('update')
        .setDescription('Update your connected wallet address')
        .addStringOption(option =>
          option.setName('address')
            .setDescription('Your new personal Solana wallet address')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const subcommand = interaction.options.getSubcommand();
      const userId = interaction.user.id;
      const username = interaction.user.username;

      if (subcommand === 'connect') {
        const address = interaction.options.getString('address');

        // Check if user already has a wallet connected
        const existingUser = await db.getUser(userId);
        if (existingUser && existingUser.solana_address) {
          const embed = new EmbedBuilder()
            .setColor('#FF9800')
            .setTitle('⚠️ Wallet Already Connected')
            .setDescription('You already have a wallet connected.')
            .addFields(
              { name: 'Current Wallet', value: `\`${existingUser.solana_address}\`` },
              { name: 'Update?', value: 'Use `/user-wallet update` to change your wallet' }
            )
            .setTimestamp();

          return interaction.editReply({ embeds: [embed] });
        }

        // Validate Solana address
        if (!crypto.isValidSolanaAddress(address)) {
          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Invalid Solana Address')
            .setDescription('The address you provided is not a valid Solana address.')
            .addFields(
              { name: 'Tips:', value: '• Use a Base58 encoded address\n• Should be 44 characters long\n• Example: `11111111111111111111111111111111`' }
            )
            .setTimestamp();

          return interaction.editReply({ embeds: [embed] });
        }

        // Add user to database
        await db.addUser(userId, username, address);

        const successEmbed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('✅ Wallet Connected Successfully')
          .setDescription('Your personal Solana wallet is now connected to your Discord account across all servers.')
          .addFields(
            { name: 'Wallet Address', value: `\`${address}\`` },
            { name: 'Status', value: '🟢 Active on all servers' },
            { name: 'Scope', value: 'Your wallet is personal and works on ANY DisCryptoBank server' },
            { name: 'Next Steps', value: 'Server admins can now send you SOL using `/pay @yourname`' }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [successEmbed] });
      }

      if (subcommand === 'view') {
        const userData = await db.getUser(userId);

        if (!userData || !userData.solana_address) {
          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ No Wallet Connected')
            .setDescription('You haven\'t connected a wallet yet.')
            .addFields(
              { name: 'Connect Now?', value: 'Use `/user-wallet connect` to add your Solana wallet' }
            )
            .setTimestamp();

          return interaction.editReply({ embeds: [embed] });
        }

        const embed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('💼 Your Connected Wallet')
          .setDescription('This is the wallet address linked to your Discord account.')
          .addFields(
            { name: 'Wallet Address', value: `\`${userData.solana_address}\`` },
            { name: 'Status', value: '🟢 Active' },
            { name: 'Connected Since', value: new Date(userData.created_at).toLocaleString() }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === 'update') {
        const newAddress = interaction.options.getString('address');

        // Check if user has a wallet
        const userData = await db.getUser(userId);
        if (!userData) {
          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ No Wallet Connected')
            .setDescription('Use `/user-wallet connect` first.')
            .setTimestamp();

          return interaction.editReply({ embeds: [embed] });
        }

        // Validate new address
        if (!crypto.isValidSolanaAddress(newAddress)) {
          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Invalid Solana Address')
            .setDescription('The address you provided is not a valid Solana address.')
            .setTimestamp();

          return interaction.editReply({ embeds: [embed] });
        }

        // Prevent updating to the same address
        if (userData.solana_address === newAddress) {
          return interaction.editReply({
            content: '⚠️ This is already your connected wallet.'
          });
        }

        // Update wallet
        await db.addUser(userId, username, newAddress);

        const embed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('✅ Wallet Updated Successfully')
          .setDescription('Your personal wallet has been updated across all DisCryptoBank servers.')
          .addFields(
            { name: 'Old Wallet', value: `\`${userData.solana_address}\`` },
            { name: 'New Wallet', value: `\`${newAddress}\`` },
            { name: 'Status', value: '🟢 Updated on all servers' }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('Error in user-wallet command:', error);
      return interaction.editReply({
        content: `❌ Error: ${error.message}`
      });
    }
  }
};
