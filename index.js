const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, EmbedBuilder } = require('discord.js');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const crypto = require('./utils/crypto');
const db = require('./utils/db');
const { ANCHOR_GUILD_ID, prefixLine, getTrustRisk } = require('./utils/trustRisk');

// Version and build info
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
const BUILD_DATE = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const LATEST_FEATURES = [
  'NEW: Trust & Risk Scoring!',
  'NEW: /contest giveaways!',
  'Auto wallet lookup on /pay',
  '/user-wallet command',
  'Solana transactions'
];

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages] });

// Command collection
client.commands = new Collection();

// Function to load commands
const loadCommands = () => {
  client.commands.clear();
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
  
  console.log('\n🔄 Loading commands...');
  let loadedCount = 0;
  const loadedNames = [];
  
  for (const file of commandFiles) {
    try {
      // Clear the require cache to get fresh command definitions
      const filePath = path.join(commandsPath, file);
      delete require.cache[require.resolve(filePath)];
      
      const command = require(filePath);
      if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`✅ Command loaded: ${command.data.name}`);
        loadedCount++;
        loadedNames.push(command.data.name);
        
        // Special logging for user-wallet
        if (command.data.name === 'user-wallet') {
          console.log(`   ⭐ IMPORTANT: /user-wallet command successfully loaded!`);
        }
      } else {
        console.log(`⚠️  ${file}: Missing data or execute property`);
      }
    } catch (error) {
      console.error(`❌ Error loading command ${file}:`, error.message);
    }
  }
  
  console.log(`\n✅ Successfully loaded ${loadedCount} commands`);
  console.log(`📋 Loaded: ${loadedNames.join(', ')}\n`);
  return loadedCount;
};

// Load commands initially
loadCommands();

// Register slash commands (Global + Guild-specific)
const registerCommands = async () => {
  const commands = [];
  for (const command of client.commands.values()) {
    commands.push(command.data.toJSON());
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 COMMAND REGISTRATION PROCESS`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📦 Total commands to register: ${commands.length}`);
    
    // Step 0: Get current commands to verify update
    console.log(`\n0️⃣ Checking current registered commands...`);
    const currentCommands = await rest.get(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID)
    );
    console.log(`   Current commands in Discord: ${currentCommands.length}`);
    
    // Step 1: Register globally (this will replace all commands)
    console.log(`\n1️⃣ Registering ${commands.length} commands GLOBALLY...`);
    const globalResult = await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log(`✅ Global registration complete: ${globalResult.length} commands registered`);
    
    // List each registered command with full details
    console.log(`\n📋 Registered Commands:`);
    globalResult.forEach((cmd, idx) => {
      console.log(`   ${idx + 1}. /${cmd.name} - ${cmd.description}`);
    });
    
    // Verify user-wallet command is registered
    const userWalletCmd = globalResult.find(cmd => cmd.name === 'user-wallet');
    if (userWalletCmd) {
      console.log(`\n✨ ✅ /user-wallet command successfully registered!`);
      console.log(`   - Name: ${userWalletCmd.name}`);
      console.log(`   - Description: ${userWalletCmd.description}`);
      console.log(`   - Subcommands: ${userWalletCmd.options?.filter(o => o.type === 1).length || 0}`);
    } else {
      console.log(`\n⚠️  ⚠️  /user-wallet command NOT found in registration!`);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Command registration completed!`);
    console.log(`⏱️  Commands may take 5-15 minutes to appear in Discord.`);
    console.log(`💡 If not visible: Try /refresh-commands or restart Discord`);
    console.log(`${'='.repeat(60)}\n`);
    
  } catch (error) {
    console.error('❌ Error registering commands:', error);
    console.error(`\n🔍 Troubleshooting:`);
    console.error(`   - Check DISCORD_TOKEN is valid`);
    console.error(`   - Check DISCORD_CLIENT_ID is correct`);
    console.error(`   - Verify bot has 'applications.commands' scope`);
    console.error(`   - Ensure bot admin permissions in server\n`);
  }
};

registerCommands();

// Bot ready event
client.once('clientReady', async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ BOT ONLINE - ${client.user.tag}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`🌐 Connected to Solana: ${process.env.SOLANA_RPC_URL}`);
  console.log(`💰 Wallet: ${crypto.getWallet()?.publicKey.toString()}`);
  console.log(`📡 LivePay Solana Payroll Engine is LIVE`);
  console.log(`\n📋 Server Information:`);
  console.log(`   - Guilds Connected: ${client.guilds.cache.size}`);
  console.log(`   - Commands Loaded: ${client.commands.size}`);
  console.log(`   - Latest Features: ${LATEST_FEATURES.slice(0, 2).join(', ')}`);
  console.log(`\n${'='.repeat(60)}\n`);
  
  // Re-register commands on startup to ensure they're fresh
  console.log(`🔄 Performing command sync on startup...`);
  await registerCommands();
  
  // Set bot presence with version and latest feature
  const featureIndex = Math.floor(Date.now() / 60000) % LATEST_FEATURES.length;
  const currentFeature = LATEST_FEATURES[featureIndex];
  
  client.user.setPresence({
    activities: [
      {
        name: `v${VERSION} • ${currentFeature} • Built ${BUILD_DATE}`,
        type: ActivityType.Playing
      }
    ],
    status: 'online'
  });
  
  console.log(`✨ Status: Playing "v${VERSION} • ${currentFeature} • Built ${BUILD_DATE}"`);
  console.log(`\n💡 TIP: If commands don't appear:`);
  console.log(`   1. Try typing / in Discord (may take 5-15 min to sync)`);
  console.log(`   2. Close and reopen Discord`);
  console.log(`   3. Wait for Railway deployment to finish\n`);
  
  // Update status every 30 seconds to cycle through features
  setInterval(() => {
    const featureIdx = Math.floor(Date.now() / 30000) % LATEST_FEATURES.length;
    const feature = LATEST_FEATURES[featureIdx];
    
    client.user.setPresence({
      activities: [
        {
          name: `v${VERSION} • ${feature} • Built ${BUILD_DATE}`,
          type: ActivityType.Playing
        }
      ],
      status: 'online'
    });
  }, 30000);

  // Contest end checker - runs every 30 seconds
  console.log('🎉 Starting contest end checker...');
  setInterval(async () => {
    try {
      const expiredContests = await db.getExpiredContests();
      
      for (const contest of expiredContests) {
        console.log(`[Contest] Processing ended contest #${contest.id}: ${contest.title}`);
        
        // Mark as ended
        await db.updateContestStatus(contest.id, 'ended');
        
        // Get all entries
        const entries = await db.getContestEntries(contest.id);
        
        if (entries.length === 0) {
          // No entries, just announce
          try {
            const channel = await client.channels.fetch(contest.channel_id);
            if (channel) {
              const noWinnersEmbed = new EmbedBuilder()
                .setColor('#FF6600')
                .setTitle(`🎉 Contest #${contest.id} Ended - No Winners`)
                .setDescription(`**${contest.title}** has ended, but no one entered.`)
                .addFields(
                  { name: '🎁 Prize', value: `${contest.prize_amount} ${contest.currency}` },
                  { name: '📊 Entries', value: '0' }
                )
                .setTimestamp();
              
              await channel.send({ embeds: [noWinnersEmbed] });
            }
          } catch (e) {
            console.log(`[Contest] Could not announce no-winner result for contest #${contest.id}`);
          }
          continue;
        }
        
        // Select random winners
        const numWinners = Math.min(contest.num_winners, entries.length);
        const shuffled = [...entries].sort(() => Math.random() - 0.5);
        const winners = shuffled.slice(0, numWinners);
        const winnerIds = winners.map(w => w.user_id);
        
        // Mark winners in database
        await db.setContestWinners(contest.id, winnerIds);
        
        // Calculate prize per winner
        const prizePerWinner = contest.prize_amount / numWinners;
        
        // Get the guild's treasury wallet for payouts
        const guildWallet = await db.getGuildWallet(contest.guild_id);
        if (!guildWallet) {
          console.log(`[Contest] No treasury wallet configured for guild ${contest.guild_id}, skipping payments`);
          // Still announce winners but note payment issue
          try {
            const channel = await client.channels.fetch(contest.channel_id);
            if (channel) {
              const winnerMentions = winnerIds.map(id => `<@${id}>`).join(', ');
              const noTreasuryEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle(`🎉🏆 Contest #${contest.id} Winners! 🏆🎉`)
                .setDescription(`**${contest.title}** has ended!\n\n⚠️ **Payment Issue:** No treasury wallet configured for this server. Winners have been selected but prizes could not be distributed automatically.`)
                .addFields(
                  { name: '🎊 Winners', value: winnerMentions || 'None' },
                  { name: '🎁 Prize Owed', value: `${prizePerWinner.toFixed(4)} ${contest.currency} each` },
                  { name: '⚠️ Action Required', value: 'Server admin must configure treasury with `/wallet connect` and manually pay winners.' }
                )
                .setTimestamp();
              
              await channel.send({
                content: `🎉 **CONTEST WINNERS!** 🎉\n\nCongratulations ${winnerMentions}!`,
                embeds: [noTreasuryEmbed]
              });
            }
          } catch (e) {
            console.log(`[Contest] Could not announce winners for contest #${contest.id}:`, e.message);
          }
          await db.updateContestStatus(contest.id, 'completed');
          continue;
        }
        
        // Check treasury balance
        const treasuryBalance = await crypto.getBalance(guildWallet.wallet_address);
        const totalPrizeNeeded = prizePerWinner * numWinners;
        
        // Distribute prizes from GUILD TREASURY (not bot wallet)
        const paymentResults = [];
        const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
        const botWallet = crypto.getWallet(); // Bot wallet signs, but funds come from treasury
        const treasuryPubkey = new PublicKey(guildWallet.wallet_address);
        
        for (const winner of winners) {
          try {
            const userData = await db.getUser(winner.user_id);
            if (userData && userData.solana_address) {
              // Check if treasury has enough balance
              if (treasuryBalance < prizePerWinner) {
                paymentResults.push({
                  userId: winner.user_id,
                  success: false,
                  reason: 'Insufficient treasury balance'
                });
                continue;
              }
              
              // Pay winner FROM GUILD TREASURY
              const recipientPubkey = new PublicKey(userData.solana_address);
              const lamports = Math.floor(prizePerWinner * 1e9);
              
              const instruction = SystemProgram.transfer({
                fromPubkey: treasuryPubkey,
                toPubkey: recipientPubkey,
                lamports: lamports
              });
              
              const transaction = new Transaction().add(instruction);
              const signature = await sendAndConfirmTransaction(connection, transaction, [botWallet]);
              
              // Record transaction
              await db.recordTransaction(contest.guild_id, guildWallet.wallet_address, userData.solana_address, prizePerWinner, signature);
              
              paymentResults.push({
                userId: winner.user_id,
                address: userData.solana_address,
                amount: prizePerWinner,
                success: true,
                signature: signature
              });
            } else {
              paymentResults.push({
                userId: winner.user_id,
                success: false,
                reason: 'No wallet connected'
              });
            }
          } catch (payError) {
            console.error(`[Contest] Payment error for winner ${winner.user_id}:`, payError);
            paymentResults.push({
              userId: winner.user_id,
              success: false,
              reason: payError.message
            });
          }
        }
        
        // Announce winners
        try {
          const channel = await client.channels.fetch(contest.channel_id);
          if (channel) {
            const winnerMentions = winnerIds.map(id => `<@${id}>`).join(', ');
            
            let paymentSummary = '';
            for (const result of paymentResults) {
              if (result.success) {
                paymentSummary += `✅ <@${result.userId}>: ${prizePerWinner.toFixed(4)} ${contest.currency} - [View TX](https://solscan.io/tx/${result.signature})\n`;
              } else {
                paymentSummary += `❌ <@${result.userId}>: Payment failed - ${result.reason}\n`;
              }
            }
            
            const winnersEmbed = new EmbedBuilder()
              .setColor('#FFD700')
              .setTitle(`🎉🏆 Contest #${contest.id} Winners Announced! 🏆🎉`)
              .setDescription(`**${contest.title}** has ended!`)
              .addFields(
                { name: '🎁 Total Prize', value: `${contest.prize_amount} ${contest.currency}`, inline: true },
                { name: '🏆 Winners', value: `${numWinners}`, inline: true },
                { name: '💰 Per Winner', value: `${prizePerWinner.toFixed(4)} ${contest.currency}`, inline: true },
                { name: '📊 Total Entries', value: `${entries.length}`, inline: true },
                { name: '🏦 Paid From', value: `Guild Treasury\n\`${guildWallet.wallet_address.slice(0, 8)}...${guildWallet.wallet_address.slice(-6)}\``, inline: true },
                { name: '🎊 Winners', value: winnerMentions || 'None' },
                { name: '💸 Prize Distribution', value: paymentSummary || 'Processing...' }
              )
              .setTimestamp();
            
            await channel.send({
              content: `🎉 **CONTEST WINNERS!** 🎉\n\nCongratulations ${winnerMentions}!`,
              embeds: [winnersEmbed]
            });
          }
        } catch (e) {
          console.log(`[Contest] Could not announce winners for contest #${contest.id}:`, e.message);
        }
        
        // Mark as completed
        await db.updateContestStatus(contest.id, 'completed');
        console.log(`[Contest] Contest #${contest.id} completed with ${numWinners} winner(s)`);
      }
    } catch (error) {
      console.error('[Contest] Error in contest end checker:', error);
    }
  }, 30000); // Check every 30 seconds
});

// Interaction handler
client.on('interactionCreate', async interaction => {
  console.log(`[${new Date().toISOString()}] 📨 Interaction received: type=${interaction.type}`);
  if (interaction.isChatInputCommand()) {
    console.log(`   Command: ${interaction.commandName}`);
  }
  if (interaction.isButton()) {
    console.log(`   Button: ${interaction.customId}`);
  }
  if (interaction.isModalSubmit()) {
    console.log(`   Modal: ${interaction.customId}`);
  }
  
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    console.log(`🔧 Processing command: ${interaction.commandName}`);
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.log(`❌ Command not found: ${interaction.commandName}`);
      return;
    }

    try {
      // ---- DCB Trust/Risk prefix injection (ALL commands) ----
      let anchorMember = false;
      try {
        const g = client.guilds.cache.get(ANCHOR_GUILD_ID) || await client.guilds.fetch(ANCHOR_GUILD_ID).catch(() => null);
        if (g) {
          const m = await g.members.fetch(interaction.user.id).catch(() => null);
          anchorMember = !!m;
        }
      } catch (_) {
        anchorMember = false;
      }

      const score = await getTrustRisk({
        db,
        user: interaction.user,
        guildId: interaction.guildId,
        guildAnchorMember: anchorMember
      });

      const prefix = prefixLine(score.trust, score.risk);

      // Log command audit
      await db.logCommandAudit(interaction.user.id, interaction.guildId, interaction.commandName).catch(() => {});

      // Wrap reply/edit/followUp so every command automatically includes prefix
      const injectPrefix = (payload) => {
        if (payload == null) return { content: prefix };
        if (typeof payload === 'string') return { content: `${prefix}\n${payload}` };
        const out = { ...payload };
        out.content = out.content ? `${prefix}\n${out.content}` : prefix;
        return out;
      };

      const _reply = interaction.reply.bind(interaction);
      const _followUp = interaction.followUp.bind(interaction);
      const _editReply = interaction.editReply.bind(interaction);

      interaction.reply = (p) => _reply(injectPrefix(p));
      interaction.followUp = (p) => _followUp(injectPrefix(p));
      interaction.editReply = (p) => _editReply(injectPrefix(p));

      // Expose score to commands that want it
      interaction.dcbTrustRisk = score;
      // --------------------------------------------------------

      console.log(`⚡ About to execute: ${interaction.commandName} (Trust: ${score.trust}, Risk: ${score.risk})`);
      await command.execute(interaction);
      console.log(`✅ Command executed successfully: ${interaction.commandName}`);
    } catch (error) {
      console.error('❌ Error executing command:', error.message);
      console.error(error.stack);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: '❌ An error occurred executing this command.', ephemeral: true });
      } else {
        await interaction.reply({ content: '❌ An error occurred executing this command.', ephemeral: true });
      }
    }
    return;
  }

  // Handle button interactions for proof verification
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('proof_verification_')) {
      const submitProofCommand = client.commands.get('submit-proof');
      if (submitProofCommand && submitProofCommand.handleVerificationButton) {
        try {
          await submitProofCommand.handleVerificationButton(interaction, client);
        } catch (error) {
          console.error('❌ Error handling verification button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: '❌ An error occurred.', ephemeral: true });
          } else {
            await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
          }
        }
      }
      return;
    }
    
    // Handle contest entry button
    if (interaction.customId.startsWith('contest_enter_')) {
      const contestCommand = client.commands.get('contest');
      if (contestCommand && contestCommand.handleEntryButton) {
        try {
          await contestCommand.handleEntryButton(interaction);
        } catch (error) {
          console.error('❌ Error handling contest entry button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: '❌ An error occurred.', ephemeral: true });
          } else {
            await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
          }
        }
      }
      return;
    }
    return;
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('proof_modal_')) {
      const submitProofCommand = client.commands.get('submit-proof');
      if (submitProofCommand && submitProofCommand.handleModal) {
        try {
          await submitProofCommand.handleModal(interaction);
        } catch (error) {
          console.error('❌ Error handling proof modal:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: '❌ An error occurred submitting your proof.', ephemeral: true });
          } else {
            await interaction.reply({ content: '❌ An error occurred submitting your proof.', ephemeral: true });
          }
        }
      }
      return;
    }
    
    // Handle contest entry modal
    if (interaction.customId.startsWith('contest_entry_modal_')) {
      const contestCommand = client.commands.get('contest');
      if (contestCommand && contestCommand.handleEntryModal) {
        try {
          await contestCommand.handleEntryModal(interaction);
        } catch (error) {
          console.error('❌ Error handling contest entry modal:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: '❌ An error occurred.', ephemeral: true });
          } else {
            await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
          }
        }
      }
      return;
    }
    return;
  }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
