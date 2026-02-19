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
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('deposit')
        .setDescription('View your DCB betting wallet address to fund it for horse races')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('balance')
        .setDescription('Check your DCB betting wallet balance')
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const subcommand = interaction.options.getSubcommand();
      const userId = interaction.user.id;
      const username = interaction.user.username;

      if (subcommand === 'connect') {
        const address = (interaction.options.getString('address') || '').trim().replace(/[^\x20-\x7E]/g, '');

        console.log(`[user-wallet] connect: userId=${userId}, raw="${interaction.options.getString('address')}", sanitized="${address}", len=${address.length}`);

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
        const newAddress = (interaction.options.getString('address') || '').trim().replace(/[^\x20-\x7E]/g, '');

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

      if (subcommand === 'deposit') {
        let userData = await db.getUser(userId);

        // Auto-generate custodial wallet if user doesn't have one yet
        if (!userData) {
          // User must connect their payout wallet first
          return interaction.editReply({
            content: '❌ Connect your payout wallet first with `/user-wallet connect address:YOUR_SOLANA_ADDRESS`'
          });
        }

        if (!userData.custodial_address || !userData.custodial_secret) {
          const { publicKey, secretKey } = crypto.generateKeypair();
          await db.setUserCustodialWallet(userId, publicKey, secretKey);
          userData = await db.getUser(userId);
          console.log(`[user-wallet] Generated custodial wallet for ${userId}: ${publicKey}`);
        }

        let balanceText = 'Checking...';
        try {
          const bal = await crypto.getBalance(userData.custodial_address);
          balanceText = `${bal.toFixed(6)} SOL`;
        } catch (_) {
          balanceText = '(unable to fetch)';
        }

        const embed = new EmbedBuilder()
          .setColor('#F1C40F')
          .setTitle('🏦 Your DCB Betting Wallet')
          .setDescription(
            'This is your **custodial betting wallet** managed by DisCryptoBank.\n' +
            'Fund it from your personal wallet to enter pot-mode horse races.\n\n' +
            '**How it works:**\n' +
            '1️⃣ Send SOL to the address below from Phantom/Solflare\n' +
            '2️⃣ When you enter a race, the entry fee is paid from this wallet\n' +
            '3️⃣ Winnings are paid to your connected payout wallet'
          )
          .addFields(
            { name: '📥 Deposit Address', value: `\`${userData.custodial_address}\`` },
            { name: '💰 Balance', value: balanceText, inline: true },
            { name: '💳 Payout Wallet', value: `\`${userData.solana_address || '(not set)'}\``, inline: true }
          )
          .setFooter({ text: 'DisCryptoBank • Betting Wallet' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === 'balance') {
        const userData = await db.getUser(userId);

        if (!userData || !userData.custodial_address) {
          return interaction.editReply({
            content: '❌ No betting wallet found. Use `/user-wallet deposit` to set one up.'
          });
        }

        let balance = 0;
        try {
          balance = await crypto.getBalance(userData.custodial_address);
        } catch (_) {}

        const embed = new EmbedBuilder()
          .setColor(balance > 0 ? '#27AE60' : '#E74C3C')
          .setTitle('💰 Betting Wallet Balance')
          .addFields(
            { name: '🏦 Betting Wallet', value: `\`${userData.custodial_address}\`` },
            { name: '💰 Balance', value: `**${balance.toFixed(6)} SOL**`, inline: true },
            { name: '💳 Payout Wallet', value: `\`${userData.solana_address || '(not set)'}\``, inline: true }
          )
          .setFooter({ text: balance > 0 ? 'Ready to race! 🏇' : 'Fund your betting wallet to enter races' })
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
