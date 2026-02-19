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
          content: '❌ **No Treasury Wallet Connected!**\n\n' +
            'This server does not have a treasury wallet configured. The `/pay` command sends SOL from the server\'s treasury wallet, so one must be connected first.\n\n' +
            '**Server Owner — set it up with:**\n' +
            '```\n/wallet connect address:YOUR_WALLET_ADDRESS secret:YOUR_PRIVATE_KEY\n```\n' +
            '• The **address** is your Solana wallet public address\n' +
            '• The **secret** is your wallet\'s private key (base58) — needed so the bot can sign payment transactions\n' +
            '   → In Phantom: Settings → Security & Privacy → Show Secret Key\n\n' +
            '💡 You can also set this up via **DCB Event Manager** (web dashboard) → Treasury.'
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

      // Get the guild's treasury keypair for signing
      const treasurySecret = guildWallet.wallet_secret;
      if (!treasurySecret) {
        return interaction.editReply({
          content: `❌ **Treasury Private Key Required!**\n\n` +
            `The treasury wallet (\`${guildWallet.wallet_address.slice(0,6)}...${guildWallet.wallet_address.slice(-4)}\`) is connected but has **no private key** stored. The \`/pay\` command needs the private key to sign transactions from this server's treasury.\n\n` +
            `**Server Owner — add the private key:**\n` +
            `\`\`\`\n/wallet connect address:${guildWallet.wallet_address} secret:YOUR_PRIVATE_KEY\n\`\`\`\n` +
            `• In Phantom: Settings → Security & Privacy → Show Secret Key\n` +
            `• The key is ~88 characters (base58) — it is stored securely and never displayed\n\n` +
            `💡 Or go to **DCB Event Manager** → Treasury → 🔑 Save Key`
        });
      }

      const treasuryKeypair = crypto.getKeypairFromSecret(treasurySecret);
      if (!treasuryKeypair) {
        console.error(`[PAY] Invalid treasury keypair for guild ${guildId}, secret length=${treasurySecret?.length}, first4=${treasurySecret?.slice(0,4)}...`);
        // Detect if the stored "secret" is actually the public address
        const isActuallyAddress = treasurySecret === guildWallet.wallet_address;
        const looksLikeAddress = treasurySecret?.length >= 32 && treasurySecret?.length <= 44;
        let hint = '';
        if (isActuallyAddress) {
          hint = `\n\n⚠️ **The stored private key is actually your PUBLIC wallet address!**\n` +
            `You entered your wallet address (\'${treasurySecret.slice(0,6)}...\') in the private key field.\n\n`;
        } else if (looksLikeAddress) {
          hint = `\n\n⚠️ **The stored key is ${treasurySecret.length} characters — that looks like a public address, not a private key.**\n` +
            `A Solana private key is ~88 characters (base58) or a JSON array of 64 numbers.\n\n`;
        }
        return interaction.editReply({
          content: `❌ Treasury wallet private key is invalid.${hint}` +
            `**How to fix:**\n` +
            `1. Go to **DCB Event Manager** → Treasury\n` +
            `2. Enter your wallet's **private key** (not the address!)\n` +
            `   • In Phantom: Settings → Security & Privacy → Show Secret Key\n` +
            `   • The secret key is ~88 characters long (base58)\n` +
            `3. Click **🔑 Save Key**`
        });
      }

      const treasuryAddress = treasuryKeypair.publicKey.toString();

      // CRITICAL: Verify the secret key belongs to THIS guild's treasury, not another guild's
      if (treasuryAddress !== guildWallet.wallet_address) {
        console.error(`[PAY] ❌ CRITICAL: Key/address mismatch for guild ${guildId}! wallet_address=${guildWallet.wallet_address}, key derives=${treasuryAddress}`);
        return interaction.editReply({
          content: `❌ **Treasury Key Mismatch!**\n\n` +
            `The stored private key derives a different address than this server's treasury wallet.\n\n` +
            `🏦 **Server treasury:** \`${guildWallet.wallet_address.slice(0,6)}...${guildWallet.wallet_address.slice(-4)}\`\n` +
            `🔑 **Key derives:** \`${treasuryAddress.slice(0,6)}...${treasuryAddress.slice(-4)}\`\n\n` +
            `**How to fix:**\n` +
            `1. Use \`/wallet connect\` with the **correct** address + private key\n` +
            `2. Or go to **DCB Event Manager** → Treasury → re-enter the correct private key`
        });
      }

      // Check treasury wallet balance
      const treasuryBalance = await crypto.getBalance(treasuryAddress);
      if (treasuryBalance < solAmount) {
        return interaction.editReply({
          content: `❌ Insufficient treasury balance. Current: ${treasuryBalance.toFixed(4)} SOL, Required: ${solAmount.toFixed(4)} SOL\n\n` +
            `Fund the treasury wallet: \`${treasuryAddress}\``
        });
      }

      // Execute the payment from treasury wallet to user
      const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
      const recipientPubkey = new PublicKey(targetUserData.solana_address);

      // Create transfer instruction (convert SOL to lamports)
      const lamports = Math.floor(solAmount * 1e9);
      const instruction = SystemProgram.transfer({
        fromPubkey: treasuryKeypair.publicKey,
        toPubkey: recipientPubkey,
        lamports: lamports
      });

      // Create and sign transaction
      const transaction = new Transaction().add(instruction);
      
      // Get latest blockhash for the transaction
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = treasuryKeypair.publicKey;
      
      const signature = await sendAndConfirmTransaction(connection, transaction, [treasuryKeypair], {
        commitment: 'confirmed',
        maxRetries: 3
      });

      // Log transaction to database
      await db.recordTransaction(guildId, treasuryAddress, targetUserData.solana_address, solAmount, signature);

      // Send success embed
      const successEmbed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle('✅ Payment Sent Successfully')
        .addFields(
          { name: 'From', value: `Treasury Wallet\n\`${treasuryAddress}\`` },
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
