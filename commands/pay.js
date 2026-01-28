const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('../utils/crypto');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Send SOL to a Discord user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Discord user to pay')
        .setRequired(true)
    )
    .addNumberOption(option =>
      option.setName('amount')
        .setDescription('Amount to send')
        .setRequired(true)
        .setMinValue(0.01)
    )
    .addStringOption(option =>
      option.setName('currency')
        .setDescription('Currency type (SOL or USD)')
        .setRequired(true)
        .addChoices(
          { name: 'SOL', value: 'SOL' },
          { name: 'USD', value: 'USD' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getNumber('amount');
      const currency = interaction.options.getString('currency');

      let solAmount = amount;

      // Convert USD to SOL if needed
      if (currency === 'USD') {
        const solPrice = await crypto.getSolanaPrice();
        if (!solPrice) {
          return interaction.editReply({
            content: '❌ Unable to fetch SOL price. Please try again later.'
          });
        }
        solAmount = amount / solPrice;
      }

      // Get wallet
      const wallet = crypto.getWallet();
      if (!wallet) {
        return interaction.editReply({
          content: '❌ Bot wallet not configured.'
        });
      }

      // Check balance
      const balance = await crypto.getBalance(wallet.publicKey.toString());
      if (balance < solAmount) {
        return interaction.editReply({
          content: `❌ Insufficient balance. Current: ${balance.toFixed(4)} SOL, Required: ${solAmount.toFixed(4)} SOL`
        });
      }

      // For now, we'll need the recipient to have provided a wallet address via /wallet connect
      // This is a simplified version - in production you'd look this up in a database
      return interaction.editReply({
        content: `⏳ Payment feature ready. ${targetUser.username} must first connect their wallet with \`/wallet connect\` with their Solana address.`
      });

    } catch (error) {
      console.error('Error processing payment:', error);
      return interaction.editReply({
        content: `❌ Error: ${error.message}`
      });
    }
  }
};
