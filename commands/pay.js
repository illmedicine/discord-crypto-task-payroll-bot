const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('../utils/crypto');
const db = require('../utils/db');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');

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

      // Check if target user is a bot
      if (targetUser.bot) {
        return interaction.editReply({
          content: '❌ Cannot pay bots. Please select a real Discord user.'
        });
      }

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

      // Get bot's wallet
      const botWallet = crypto.getWallet();
      if (!botWallet) {
        return interaction.editReply({
          content: '❌ Bot wallet not configured.'
        });
      }

      // Check bot's balance
      const botBalance = await crypto.getBalance(botWallet.publicKey.toString());
      if (botBalance < solAmount) {
        return interaction.editReply({
          content: `❌ Insufficient bot balance. Current: ${botBalance.toFixed(4)} SOL, Required: ${solAmount.toFixed(4)} SOL`
        });
      }

      // Look up target user's connected wallet
      const targetUserData = await db.getUser(targetUser.id);
      
      if (!targetUserData || !targetUserData.solana_address) {
        const embed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('❌ Wallet Not Connected')
          .setDescription(`${targetUser.username} has not connected their Solana wallet yet.`)
          .addFields(
            { name: 'What they need to do:', value: `1. Use the \`/wallet connect\` command\n2. Provide their Solana wallet address\n3. Once connected, you can pay them` },
            { name: 'Waiting for:', value: targetUser.toString() }
          )
          .setTimestamp();

        return interaction.editReply({
          embeds: [embed]
        });
      }

      // Validate the recipient's Solana address
      if (!crypto.isValidSolanaAddress(targetUserData.solana_address)) {
        return interaction.editReply({
          content: `❌ ${targetUser.username}'s wallet address is invalid. Please ask them to reconnect with a valid address.`
        });
      }

      // Execute the payment
      const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
      const recipientPubkey = new PublicKey(targetUserData.solana_address);
      const senderPubkey = botWallet.publicKey;

      // Create transfer instruction (convert SOL to lamports)
      const lamports = Math.floor(solAmount * 1e9);
      const instruction = SystemProgram.transfer({
        fromPubkey: senderPubkey,
        toPubkey: recipientPubkey,
        lamports: lamports
      });

      // Create and sign transaction
      const transaction = new Transaction().add(instruction);
      const signature = await sendAndConfirmTransaction(connection, transaction, [botWallet]);

      // Log transaction to database
      await db.recordTransaction(interaction.guildId, senderPubkey.toString(), targetUserData.solana_address, solAmount, signature);

      // Send success embed
      const successEmbed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle('✅ Payment Sent Successfully')
        .addFields(
          { name: 'Recipient', value: `${targetUser.username}\n\`${targetUserData.solana_address}\`` },
          { name: 'Amount', value: `${solAmount.toFixed(4)} SOL${currency === 'USD' ? ` (~$${amount.toFixed(2)} USD)` : ''}` },
          { name: 'Transaction', value: `[View on Explorer](https://solscan.io/tx/${signature})` },
          { name: 'Sent By', value: interaction.user.username }
        )
        .setTimestamp();

      return interaction.editReply({
        embeds: [successEmbed]
      });

    } catch (error) {
      console.error('Error processing payment:', error);
      return interaction.editReply({
        content: `❌ Error: ${error.message}`
      });
    }
  }
};
