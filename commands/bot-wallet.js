const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('../utils/crypto');
const db = require('../utils/db');

// Bot owner Discord ID - only this user can access bot wallet commands
const BOT_OWNER_ID = '1075818871149305966';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bot-wallet')
    .setDescription('Bot wallet management (Owner only)')
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('View bot wallet information and balance')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('transactions')
        .setDescription('View global transaction ledger')
        .addIntegerOption(option =>
          option.setName('limit')
            .setDescription('Number of transactions to show (default: 20)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('guilds')
        .setDescription('View all connected guilds and their treasury wallets')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('users')
        .setDescription('View all registered users and their wallets')
        .addIntegerOption(option =>
          option.setName('limit')
            .setDescription('Number of users to show (default: 20)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('stats')
        .setDescription('View global DisCryptoBank statistics')
    ),

  async execute(interaction) {
    // Security check - only bot owner can use this command
    if (interaction.user.id !== BOT_OWNER_ID) {
      return interaction.reply({
        content: '❌ This command is restricted to the DisCryptoBank owner only.',
        ephemeral: true
      });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'info') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const botWallet = crypto.getWallet();
        if (!botWallet) {
          return interaction.editReply({
            content: '❌ Bot wallet not configured. Please set SOLANA_PRIVATE_KEY in environment.'
          });
        }

        const walletAddress = botWallet.publicKey.toString();
        const balance = await crypto.getBalance(walletAddress);
        const price = await crypto.getSolanaPrice();
        const usdValue = price ? (balance * price).toFixed(2) : 'N/A';

        const embed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('🤖 DisCryptoBank Bot Wallet')
          .setDescription('Central funding source for all DisCryptoBank transactions')
          .addFields(
            { name: '💰 SOL Balance', value: `${balance.toFixed(4)} SOL`, inline: true },
            { name: '💵 USD Value', value: `$${usdValue}`, inline: true },
            { name: '🌐 Network', value: process.env.CLUSTER || 'mainnet-beta', inline: true },
            { name: '🔑 Public Address', value: `\`${walletAddress}\`` },
            { name: '📡 RPC Endpoint', value: process.env.SOLANA_RPC_URL || 'api.mainnet-beta.solana.com' },
            { name: '🔒 Security', value: 'This wallet signs all transactions on behalf of guild treasuries' }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Bot wallet info error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }

    if (subcommand === 'transactions') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const limit = interaction.options.getInteger('limit') || 20;

        // Get all transactions globally
        const transactions = await new Promise((resolve, reject) => {
          db.db.all(
            `SELECT t.*, gw.wallet_address as treasury_address 
             FROM transactions t 
             LEFT JOIN guild_wallets gw ON t.guild_id = gw.guild_id 
             ORDER BY t.created_at DESC 
             LIMIT ?`,
            [limit],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            }
          );
        });

        if (transactions.length === 0) {
          return interaction.editReply({
            content: '📋 No transactions recorded yet.'
          });
        }

        let txList = '';
        for (const tx of transactions) {
          const shortFrom = `${tx.from_address.slice(0, 6)}...${tx.from_address.slice(-4)}`;
          const shortTo = `${tx.to_address.slice(0, 6)}...${tx.to_address.slice(-4)}`;
          const date = new Date(tx.created_at).toLocaleDateString();
          txList += `**#${tx.id}** | ${tx.amount.toFixed(4)} SOL | ${shortFrom} → ${shortTo}\n`;
          txList += `   Guild: \`${tx.guild_id}\` | ${date}\n`;
        }

        const embed = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle('📜 Global Transaction Ledger')
          .setDescription(txList || 'No transactions')
          .setFooter({ text: `Showing ${transactions.length} of ${limit} requested` })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Bot wallet transactions error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }

    if (subcommand === 'guilds') {
      await interaction.deferReply({ ephemeral: true });

      try {
        // Get all connected guilds
        const guilds = await new Promise((resolve, reject) => {
          db.db.all(
            `SELECT * FROM guild_wallets ORDER BY configured_at DESC`,
            [],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            }
          );
        });

        if (guilds.length === 0) {
          return interaction.editReply({
            content: '📋 No guilds have connected treasury wallets yet.'
          });
        }

        let guildList = '';
        for (const guild of guilds) {
          const shortWallet = `${guild.wallet_address.slice(0, 8)}...${guild.wallet_address.slice(-6)}`;
          const date = new Date(guild.configured_at).toLocaleDateString();
          guildList += `**Guild:** \`${guild.guild_id}\`\n`;
          guildList += `   💰 Treasury: \`${shortWallet}\`\n`;
          guildList += `   👤 Configured by: <@${guild.configured_by}> | ${date}\n\n`;
        }

        const embed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('🏦 Connected Guild Treasuries')
          .setDescription(guildList)
          .addFields(
            { name: 'Total Guilds', value: `${guilds.length}`, inline: true }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Bot wallet guilds error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }

    if (subcommand === 'users') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const limit = interaction.options.getInteger('limit') || 20;

        // Get all registered users
        const users = await new Promise((resolve, reject) => {
          db.db.all(
            `SELECT * FROM users ORDER BY created_at DESC LIMIT ?`,
            [limit],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            }
          );
        });

        if (users.length === 0) {
          return interaction.editReply({
            content: '📋 No users have connected wallets yet.'
          });
        }

        let userList = '';
        for (const user of users) {
          const shortWallet = user.solana_address 
            ? `${user.solana_address.slice(0, 8)}...${user.solana_address.slice(-6)}` 
            : 'Not connected';
          const date = new Date(user.created_at).toLocaleDateString();
          userList += `<@${user.discord_id}> (\`${user.username}\`)\n`;
          userList += `   💼 Wallet: \`${shortWallet}\` | ${date}\n`;
        }

        const embed = new EmbedBuilder()
          .setColor('#9945FF')
          .setTitle('👥 Registered Users')
          .setDescription(userList)
          .setFooter({ text: `Showing ${users.length} users (global across all servers)` })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Bot wallet users error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }

    if (subcommand === 'stats') {
      await interaction.deferReply({ ephemeral: true });

      try {
        // Get various stats
        const stats = await new Promise((resolve, reject) => {
          const result = {};
          
          db.db.get(`SELECT COUNT(*) as count FROM guild_wallets`, [], (err, row) => {
            result.totalGuilds = row?.count || 0;
            
            db.db.get(`SELECT COUNT(*) as count FROM users`, [], (err, row) => {
              result.totalUsers = row?.count || 0;
              
              db.db.get(`SELECT COUNT(*) as count, SUM(amount) as total FROM transactions`, [], (err, row) => {
                result.totalTransactions = row?.count || 0;
                result.totalVolume = row?.total || 0;
                
                db.db.get(`SELECT COUNT(*) as count FROM bulk_tasks WHERE status = 'active'`, [], (err, row) => {
                  result.activeTasks = row?.count || 0;
                  
                  db.db.get(`SELECT COUNT(*) as count FROM contests WHERE status = 'active'`, [], (err, row) => {
                    result.activeContests = row?.count || 0;
                    
                    db.db.get(`SELECT COUNT(*) as count FROM proof_submissions WHERE status = 'pending'`, [], (err, row) => {
                      result.pendingProofs = row?.count || 0;
                      resolve(result);
                    });
                  });
                });
              });
            });
          });
        });

        const botWallet = crypto.getWallet();
        let botBalance = 0;
        if (botWallet) {
          botBalance = await crypto.getBalance(botWallet.publicKey.toString());
        }

        const embed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('📊 DisCryptoBank Global Statistics')
          .setDescription('Overview of all DisCryptoBank activity across Discord')
          .addFields(
            { name: '🏦 Connected Guilds', value: `${stats.totalGuilds}`, inline: true },
            { name: '👥 Registered Users', value: `${stats.totalUsers}`, inline: true },
            { name: '💸 Total Transactions', value: `${stats.totalTransactions}`, inline: true },
            { name: '💰 Total Volume', value: `${(stats.totalVolume || 0).toFixed(4)} SOL`, inline: true },
            { name: '📋 Active Tasks', value: `${stats.activeTasks}`, inline: true },
            { name: '🎉 Active Contests', value: `${stats.activeContests}`, inline: true },
            { name: '⏳ Pending Proofs', value: `${stats.pendingProofs}`, inline: true },
            { name: '🤖 Bot Wallet Balance', value: `${botBalance.toFixed(4)} SOL`, inline: true }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Bot wallet stats error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }
  }
};
