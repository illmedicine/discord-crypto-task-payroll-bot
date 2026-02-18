const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('../utils/crypto');
const db = require('../utils/db');
const { getGuildWalletWithFallback } = require('../utils/walletSync');
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
      const guildId = interaction.guildId;

      // Verify this is a guild command
      if (!guildId) {
        return interaction.editReply({
          content: '❌ This command can only be used in a Discord server.'
        });
      }

      // Check if target user is a bot
      if (targetUser.bot) {
        return interaction.editReply({
          content: '❌ Cannot pay bots. Please select a real Discord user.'
        });
      }

      // Check if target user is a member of this guild
      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return interaction.editReply({
          content: `❌ ${targetUser.username} is not a member of this Discord server. You can only pay members of this server.`
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

      // Get guild's treasury wallet (with backend sync fallback)
      const guildWallet = await getGuildWalletWithFallback(guildId);
      if (!guildWallet) {
        return interaction.editReply({
          content: '❌ This server does not have a treasury wallet configured yet.\n\n**Server Owner:** Use `/wallet connect` or **DCB Event Manager** to set up the treasury wallet.'
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
            { name: 'What they need to do:', value: `1. Use the \`/user-wallet connect\` command\n2. Provide their Solana wallet address\n3. Once connected, you can pay them` },
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

      // Get the bot's wallet which will sign and fund the transaction
      const botWallet = crypto.getWallet();
      if (!botWallet) {
        return interaction.editReply({
          content: '❌ Bot wallet not configured.'
        });
      }

      // Check bot wallet has sufficient balance for the payment
      const botBalance = await crypto.getBalance(botWallet.publicKey.toString());
      if (botBalance < solAmount) {
        return interaction.editReply({
          content: `❌ Insufficient bot wallet balance. Current: ${botBalance.toFixed(4)} SOL, Required: ${solAmount.toFixed(4)} SOL`
        });
      }

      // Execute the payment from bot wallet to user
      const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
      const recipientPubkey = new PublicKey(targetUserData.solana_address);

      // Create transfer instruction (convert SOL to lamports)
      const lamports = Math.floor(solAmount * 1e9);
      const instruction = SystemProgram.transfer({
        fromPubkey: botWallet.publicKey,
        toPubkey: recipientPubkey,
        lamports: lamports
      });

      // Create and sign transaction
      const transaction = new Transaction().add(instruction);
      
      // Get latest blockhash for the transaction
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = botWallet.publicKey;
      
      const signature = await sendAndConfirmTransaction(connection, transaction, [botWallet], {
        commitment: 'confirmed',
        maxRetries: 3
      });

      // Log transaction to database
      await db.recordTransaction(guildId, botWallet.publicKey.toString(), targetUserData.solana_address, solAmount, signature);

      // Send success embed
      const successEmbed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle('✅ Payment Sent Successfully')
        .addFields(
          { name: 'From', value: `Bot Wallet\n\`${botWallet.publicKey.toString()}\`` },
          { name: 'To', value: `${targetUser.username}\n\`${targetUserData.solana_address}\`` },
          { name: 'Amount', value: `${solAmount.toFixed(4)} SOL${currency === 'USD' ? ` (~$${amount.toFixed(2)} USD)` : ''}` },
          { name: 'Transaction', value: `[View on Explorer](https://solscan.io/tx/${signature})` },
          { name: 'Sent By', value: interaction.user.username },
          { name: 'Server', value: interaction.guild.name }
        )
        .setTimestamp();

      return interaction.editReply({
        embeds: [successEmbed]
      });

    } catch (error) {
      console.error('Error processing payment:', error);
      
      // Enhanced error handling for Solana-specific errors
      let errorMessage = error.message;
      
      // Check if this is a SendTransactionError with logs
      if (error.logs && Array.isArray(error.logs)) {
        console.error('Transaction logs:', error.logs);
        errorMessage += '\n\n**Transaction Logs:**\n' + error.logs.slice(0, 5).join('\n');
      }
      
      // Handle specific error types
      if (errorMessage.includes('insufficient funds') || errorMessage.includes('Insufficient funds')) {
        errorMessage = '❌ Transaction failed: Insufficient funds. The bot wallet needs more SOL to process this payment and cover transaction fees.';
      } else if (errorMessage.toLowerCase().includes('signature verification')) {
        errorMessage = '❌ Transaction failed: Signature verification error. Please try again or contact support.';
      } else if (errorMessage.includes('simulation failed')) {
        errorMessage = `❌ Transaction simulation failed: ${errorMessage}\n\nThis usually means there's an issue with the account state or insufficient rent. Please ensure the bot wallet has enough SOL.`;
      }
      
      return interaction.editReply({
        content: errorMessage
      });
    }
  }
};
