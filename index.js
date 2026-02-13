const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, EmbedBuilder } = require('discord.js');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Better runtime logging for debugging deploy issues
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

console.log('[ENV] DISCORD_TOKEN set:', !!process.env.DISCORD_TOKEN);
console.log('[ENV] DISCORD_CLIENT_ID set:', !!process.env.DISCORD_CLIENT_ID);
console.log('[ENV] DISCORD_CLIENT_SECRET set:', !!process.env.DISCORD_CLIENT_SECRET);
console.log('[ENV] DCB_SESSION_SECRET set:', !!process.env.DCB_SESSION_SECRET);


const crypto = require('./utils/crypto');
const db = require('./utils/db');
const { ANCHOR_GUILD_ID, prefixLine, getTrustRisk } = require('./utils/trustRisk');

// Version and build info
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
const BUILD_DATE = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const LATEST_FEATURES = [
  'NEW: Trust & Risk Scoring!',
  'Auto wallet lookup on /pay',
  '/user-wallet command',
  'Solana transactions'
];

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences] });

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

registerCommands().catch(() => {});

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
  console.log(`\n📋 Guild List:`);
  client.guilds.cache.forEach(g => console.log(`   - ${g.id}: ${g.name} (owner: ${g.ownerId})`));
  console.log(`\n${'='.repeat(60)}\n`);
  
  // Re-register commands on startup to ensure they're fresh
  console.log(`🔄 Performing command sync on startup...`);
  registerCommands().catch(() => {});
  
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

  // Vote Event end checker - runs every 30 seconds
  const { processVoteEvent } = require('./utils/voteEventProcessor');
  console.log('🗳️ Starting vote event end checker...');
  setInterval(async () => {
    try {
      const expiredVoteEvents = await db.getExpiredVoteEvents();
      for (const event of expiredVoteEvents) {
        await processVoteEvent(event.id, client, 'time');
      }
    } catch (error) {
      console.error('[VoteEvent] Error in vote event end checker:', error);
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

      // Track worker activity if user is a DCB worker
      if (interaction.guildId) {
        db.getWorker(interaction.guildId, interaction.user.id).then(worker => {
          if (worker) {
            const today = new Date().toISOString().slice(0, 10);
            db.logWorkerActivity(interaction.guildId, interaction.user.id, 'command', `/${interaction.commandName}`, null, null, interaction.channelId).catch(() => {});
            db.upsertWorkerDailyStat(interaction.guildId, interaction.user.id, today, 'commands_run', 1).catch(() => {});
            // Track payout commands specifically
            if (['pay', 'task-approve', 'approve-proof'].includes(interaction.commandName)) {
              db.upsertWorkerDailyStat(interaction.guildId, interaction.user.id, today, 'payouts_issued', 1).catch(() => {});
            }
          }
        }).catch(() => {});
      }

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
    
    // Handle vote event join button
    if (interaction.customId.startsWith('vote_event_join_')) {
      const voteEventCommand = client.commands.get('vote-event');
      if (voteEventCommand && voteEventCommand.handleJoinButton) {
        try {
          await voteEventCommand.handleJoinButton(interaction);
        } catch (error) {
          console.error('❌ Error handling vote event join button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: '❌ An error occurred.', ephemeral: true });
          } else {
            await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
          }
        }
      }
      return;
    }

    // Handle per-image vote buttons (vote_event_imgvote_{eventId}_{imageId})
    if (interaction.customId.startsWith('vote_event_imgvote_')) {
      const voteEventCommand = client.commands.get('vote-event');
      if (voteEventCommand && voteEventCommand.handleVoteSubmit) {
        try {
          // Parse eventId and imageId from customId
          const parts = interaction.customId.split('_'); // vote_event_imgvote_{eventId}_{imageId}
          const imageId = parts.slice(4).join('_'); // image IDs may contain underscores
          // Emulate a select menu interaction shape so handleVoteSubmit can process it
          interaction.values = [imageId];
          // Re-compose a customId that handleVoteSubmit expects: vote_event_vote_{eventId}
          interaction._originalCustomId = interaction.customId;
          interaction.customId = `vote_event_vote_${parts[3]}`;
          await voteEventCommand.handleVoteSubmit(interaction);
        } catch (error) {
          console.error('❌ Error handling image vote button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: '❌ An error occurred.', ephemeral: true });
          } else {
            await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
          }
        }
      }
      return;
    }

    // Handle contest enter button (web-published)
    if (interaction.customId.startsWith('contest_enter_')) {
      try {
        const contestId = Number(interaction.customId.split('_')[2]);
        if (!contestId) {
          await interaction.reply({ content: '❌ Invalid contest.', ephemeral: true });
          return;
        }

        const contest = await db.getContest(contestId);
        if (!contest || contest.guild_id !== interaction.guildId) {
          await interaction.reply({ content: '❌ Contest not found in this server.', ephemeral: true });
          return;
        }
        if (contest.status !== 'active') {
          await interaction.reply({ content: '❌ This contest is not active.', ephemeral: true });
          return;
        }
        if (contest.current_entries >= contest.max_entries) {
          await interaction.reply({ content: '❌ This contest is full (max entries reached).', ephemeral: true });
          return;
        }

        const existing = await db.getContestEntry(contestId, interaction.user.id);
        if (existing) {
          await interaction.reply({ content: '❌ You have already entered this contest.', ephemeral: true });
          return;
        }

        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        const modal = new ModalBuilder()
          .setCustomId(`contest_entry_modal_${contestId}`)
          .setTitle('Enter Contest');

        const screenshotUrlInput = new TextInputBuilder()
          .setCustomId('screenshot_url')
          .setLabel('Screenshot URL (optional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(screenshotUrlInput));
        await interaction.showModal(modal);
      } catch (error) {
        console.error('❌ Error handling contest enter button:', error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: '❌ An error occurred.', ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
        }
      }
      return;
    }

    // Handle contest info button (web-published)
    if (interaction.customId.startsWith('contest_info_')) {
      try {
        const contestId = Number(interaction.customId.split('_')[2]);
        const contest = await db.getContest(contestId);
        if (!contest || contest.guild_id !== interaction.guildId) {
          await interaction.reply({ content: '❌ Contest not found in this server.', ephemeral: true });
          return;
        }
        const endTimestamp = contest.ends_at ? Math.floor(new Date(contest.ends_at).getTime() / 1000) : null;
        const embed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle(`🏆 ${contest.title}`)
          .setDescription(contest.description || '')
          .addFields(
            { name: '🎁 Prize', value: `${contest.prize_amount} ${contest.currency}`, inline: true },
            { name: '👑 Winners', value: `${contest.num_winners}`, inline: true },
            { name: '🎟️ Entries', value: `${contest.current_entries}/${contest.max_entries}`, inline: true },
            { name: '🔗 Reference', value: contest.reference_url }
          )
          .setFooter({ text: `Contest #${contestId}` })
          .setTimestamp();
        if (endTimestamp) embed.addFields({ name: '⏱️ Ends', value: `<t:${endTimestamp}:R>`, inline: true });
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (error) {
        console.error('❌ Error handling contest info button:', error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: '❌ An error occurred.', ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
        }
      }
      return;
    }

    // Handle bulk task claim button (web-published)
    if (interaction.customId.startsWith('bulk_task_claim_')) {
      try {
        const taskId = Number(interaction.customId.split('_')[3]);
        const task = await db.getBulkTask(taskId);
        if (!task || task.guild_id !== interaction.guildId) {
          await interaction.reply({ content: '❌ Task not found in this server.', ephemeral: true });
          return;
        }
        if (task.status !== 'active') {
          await interaction.reply({ content: '❌ This task is not active.', ephemeral: true });
          return;
        }
        if (task.filled_slots >= task.total_slots) {
          await interaction.reply({ content: '❌ This task is full - all slots have been claimed.', ephemeral: true });
          return;
        }

        const assignmentId = await db.assignTaskToUser(taskId, interaction.guildId, interaction.user.id, interaction.channelId);
        await interaction.reply({ content: `✅ Slot claimed! Assignment ID: #${assignmentId}\nUse /submit-proof assignment_id: ${assignmentId} to submit proof.`, ephemeral: true });
      } catch (error) {
        console.error('❌ Error handling bulk task claim button:', error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: '❌ An error occurred.', ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
        }
      }
      return;
    }
  }
  
  // Handle select menu interactions
  if (interaction.isStringSelectMenu()) {
    // Handle vote event voting
    if (interaction.customId.startsWith('vote_event_vote_')) {
      const voteEventCommand = client.commands.get('vote-event');
      if (voteEventCommand && voteEventCommand.handleVoteSubmit) {
        try {
          await voteEventCommand.handleVoteSubmit(interaction);
        } catch (error) {
          console.error('❌ Error handling vote submission:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: '❌ An error occurred.', ephemeral: true });
          } else {
            await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
          }
        }
      }
      return;
    }

    // Handle add image to vote event select menu
    if (interaction.customId === 'add_image_to_vote_event') {
      try {
        // Get selected event ID
        const eventId = interaction.values[0];
        // Get image(s) from global (set by context menu)
        const images = global.voteEventSelections && global.voteEventSelections[interaction.user.id] ? global.voteEventSelections[interaction.user.id] : [];
        if (!images.length) {
          await interaction.reply({ content: '❌ No image found to add.', ephemeral: true });
          return;
        }
        // Get current images for event to determine upload order
        const eventImages = await db.getVoteEventImages(eventId);
        let uploadOrder = eventImages.length + 1;
        for (const img of images) {
          // Prevent duplicate image IDs
          if (!eventImages.some(ei => ei.image_id === img.id)) {
            await db.addVoteEventImage(eventId, img.id, img.url, uploadOrder++);
          }
        }
        // Clean up global
        if (global.voteEventSelections) delete global.voteEventSelections[interaction.user.id];
        await interaction.reply({ content: `✅ Image(s) added to the selected vote event!`, ephemeral: true });
      } catch (err) {
        console.error('❌ Error adding image to vote event:', err);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: '❌ An error occurred adding the image to the vote event.', ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ An error occurred adding the image to the vote event.', ephemeral: true });
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

    // Handle contest entry modal (web-published)
    if (interaction.customId.startsWith('contest_entry_modal_')) {
      try {
        const contestId = Number(interaction.customId.split('_')[3]);
        const contest = await db.getContest(contestId);
        if (!contest || contest.guild_id !== interaction.guildId) {
          await interaction.reply({ content: '❌ Contest not found in this server.', ephemeral: true });
          return;
        }
        if (contest.status !== 'active') {
          await interaction.reply({ content: '❌ This contest is not active.', ephemeral: true });
          return;
        }
        if (contest.current_entries >= contest.max_entries) {
          await interaction.reply({ content: '❌ This contest is full (max entries reached).', ephemeral: true });
          return;
        }

        const existing = await db.getContestEntry(contestId, interaction.user.id);
        if (existing) {
          await interaction.reply({ content: '❌ You have already entered this contest.', ephemeral: true });
          return;
        }

        const screenshotUrl = interaction.fields.getTextInputValue('screenshot_url') || null;
        await db.addContestEntry(contestId, interaction.guildId, interaction.user.id, screenshotUrl);

        await interaction.reply({ content: `✅ You are entered into contest #${contestId}!`, ephemeral: true });
      } catch (error) {
        console.error('❌ Error handling contest entry modal:', error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: '❌ An error occurred.', ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
        }
      }
      return;
    }
    return;
  }
});

// Track messages from DCB workers for activity stats
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  try {
    const worker = await db.getWorker(message.guild.id, message.author.id);
    if (worker) {
      const today = new Date().toISOString().slice(0, 10);
      db.upsertWorkerDailyStat(message.guild.id, message.author.id, today, 'messages_sent', 1).catch(() => {});
    }
  } catch (_) {}
});

// Track presence updates for worker online-time (approximate in 5-min increments)
const _workerPresenceCache = new Map();
client.on('presenceUpdate', (oldPresence, newPresence) => {
  if (!newPresence?.user || newPresence.user.bot) return;
  const guildId = newPresence.guild?.id;
  const userId = newPresence.userId;
  if (!guildId) return;

  const key = `${guildId}:${userId}`;
  const now = Date.now();

  if (newPresence.status === 'online' || newPresence.status === 'idle' || newPresence.status === 'dnd') {
    if (!_workerPresenceCache.has(key)) {
      _workerPresenceCache.set(key, now);
    }
  } else {
    // Going offline — credit time if they were a worker
    const start = _workerPresenceCache.get(key);
    if (start) {
      _workerPresenceCache.delete(key);
      const mins = Math.max(1, Math.round((now - start) / 60000));
      const today = new Date().toISOString().slice(0, 10);
      db.getWorker(guildId, userId).then(worker => {
        if (worker) {
          db.upsertWorkerDailyStat(guildId, userId, today, 'online_minutes', mins).catch(() => {});
        }
      }).catch(() => {});
    }
  }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('[Discord] login failed:', err?.message || err);
});

// Start integrated API server (provides HTTP endpoints for the web UI)
try {
  require('./server/api')(client);
} catch (err) {
  console.error('[API] Unable to start API server:', err.message);
}
// Start scheduler for scheduled posts
try {
  const fs = require('fs');
  const schedulerPath = path.join(__dirname, 'server', 'scheduler.js');
  if (fs.existsSync(schedulerPath)) {
    require('./server/scheduler')(client);
  }
} catch (err) {
  console.error('[Scheduler] Unable to start scheduler:', err.message);
}
