const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, EmbedBuilder } = require('discord.js');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Suppress discord.js v14→v15 'ready' rename deprecation (we already use 'clientReady')
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  if (typeof warning === 'string' && warning.includes('ready event has been renamed')) return;
  originalEmitWarning.call(process, warning, ...args);
};

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

// ---- Backend activity sync ----
const DCB_BACKEND_URL = process.env.DCB_BACKEND_URL || '';
const DCB_INTERNAL_SECRET = process.env.DCB_INTERNAL_SECRET || '';

function pushToBackend(endpoint, body) {
  if (!DCB_BACKEND_URL || !DCB_INTERNAL_SECRET) return;
  const url = `${DCB_BACKEND_URL.replace(/\/$/, '')}${endpoint}`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dcb-internal-secret': DCB_INTERNAL_SECRET },
    body: JSON.stringify(body)
  }).then(r => {
    if (!r.ok) console.error(`[SYNC] ${endpoint} failed: ${r.status}`);
  }).catch(err => {
    console.error(`[SYNC] ${endpoint} error:`, err.message);
  });
}

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
  const DCB_BACKEND_URL = process.env.DCB_BACKEND_URL || '';
  const DCB_INTERNAL_SECRET = process.env.DCB_INTERNAL_SECRET || '';
  console.log('🗳️ Starting vote event end checker...');
  setInterval(async () => {
    try {
      const expiredVoteEvents = await db.getExpiredVoteEvents();
      for (const event of expiredVoteEvents) {
        // --- Guard: verify against backend before ending ---
        // The backend DB is the source of truth for web-created events.
        // The bot's local copy may have a stale ends_at (e.g. from creation
        // time rather than publish time).  Refresh before processing.
        if (DCB_BACKEND_URL && DCB_INTERNAL_SECRET) {
          try {
            const url = `${DCB_BACKEND_URL.replace(/\/$/, '')}/api/internal/vote-event/${event.id}`;
            const res = await fetch(url, {
              headers: { 'x-dcb-internal-secret': DCB_INTERNAL_SECRET }
            });
            if (res.ok) {
              const { event: backendEvent } = await res.json();
              if (backendEvent) {
                // If backend still considers the event active and ends_at is
                // in the future, update local DB and skip processing.
                const endsAtMs = backendEvent.ends_at
                  ? new Date(backendEvent.ends_at).getTime()
                  : 0;
                if (backendEvent.status === 'active' && endsAtMs > Date.now()) {
                  // Refresh local cache with correct data
                  try { await db.createVoteEventFromSync(backendEvent, []); } catch (_) {}
                  console.log(`[VoteEvent] Skipping premature expiry for #${event.id} — backend says still active until ${backendEvent.ends_at}`);
                  continue;
                }
              }
            }
          } catch (backendErr) {
            console.warn(`[VoteEvent] Backend check failed for #${event.id}, proceeding with local data:`, backendErr.message);
          }
        }
        await processVoteEvent(event.id, client, 'time');
      }
    } catch (error) {
      console.error('[VoteEvent] Error in vote event end checker:', error);
    }
  }, 30000); // Check every 30 seconds

  // Gambling Event end checker - runs every 30 seconds
  const { processGamblingEvent } = require('./utils/gamblingEventProcessor');
  console.log('🎰 Starting gambling event end checker...');
  setInterval(async () => {
    try {
      const expiredGamblingEvents = await db.getExpiredGamblingEvents();
      for (const event of expiredGamblingEvents) {
        await processGamblingEvent(event.id, client, 'time');
      }
    } catch (error) {
      console.error('[GamblingEvent] Error in gambling event end checker:', error);
    }
  }, 30000);
});

// Interaction handler
const BUILD_TIMESTAMP = new Date().toISOString();
console.log(`🔧 Build timestamp: ${BUILD_TIMESTAMP}`);
client.on('interactionCreate', async interaction => {
  try {
  console.log(`[${new Date().toISOString()}] 📨 Interaction received: type=${interaction.type} (build: ${BUILD_TIMESTAMP})`);
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

      // Log command audit locally
      await db.logCommandAudit(interaction.user.id, interaction.guildId, interaction.commandName).catch(() => {});

      // Push command activity to backend API (bridges separate DBs)
      if (interaction.guildId) {
        pushToBackend('/api/internal/log-command', {
          guildId: interaction.guildId,
          discordId: interaction.user.id,
          commandName: interaction.commandName,
          channelId: interaction.channelId,
          username: interaction.user.username
        });
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

      // Track event creation commands
      if (interaction.guildId && ['gambling-event'].includes(interaction.commandName)) {
        const sub = interaction.options?.getSubcommand?.(false);
        if (sub === 'create') {
          pushToBackend('/api/internal/log-event-created', {
            guildId: interaction.guildId,
            discordId: interaction.user.id,
            detail: `Created ${interaction.commandName}${sub ? ` ${sub}` : ''}`,
            channelId: interaction.channelId
          });
        }
      }
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
    
    // Handle gambling event bet buttons
    if (interaction.customId.startsWith('gamble_bet_')) {
      console.log(`[GamblingBet] 🎰 Button handler entered for customId: ${interaction.customId} (build: ${BUILD_TIMESTAMP})`);
      try {
        await interaction.deferReply({ ephemeral: true });
        console.log(`[GamblingBet] ✅ deferReply succeeded`);
      } catch (deferErr) {
        console.error(`[GamblingBet] ❌ deferReply FAILED:`, deferErr.message);
        return;
      }

      const gamblingEventCommand = client.commands.get('gambling-event');
      console.log(`[GamblingBet] Command loaded: ${!!gamblingEventCommand}, hasHandler: ${!!(gamblingEventCommand?.handleBetButton)}`);
      if (gamblingEventCommand && gamblingEventCommand.handleBetButton) {
        try {
          await gamblingEventCommand.handleBetButton(interaction);
        } catch (error) {
          console.error('❌ Error handling gambling bet button:', error);
          console.error('❌ Stack:', error?.stack);
          const errMsg = error?.message || 'Unknown error';
          try {
            if (interaction.replied) {
              await interaction.followUp({ content: `❌ An error occurred while placing your bet: ${errMsg}`, ephemeral: true });
            } else {
              await interaction.editReply({ content: `❌ An error occurred while placing your bet: ${errMsg}` });
            }
          } catch (replyErr) {
            console.error('❌ Could not send error reply:', replyErr.message);
          }
        }
      } else {
        console.error('❌ gambling-event command not loaded! Cannot handle bet button.');
        console.error('❌ Loaded commands:', Array.from(client.commands.keys()).join(', '));
        try {
          await interaction.editReply({ content: '❌ Gambling system is temporarily unavailable. Please try again in a moment.' });
        } catch (replyErr) {
          console.error('❌ Could not send fallback reply:', replyErr.message);
        }
      }
      return;
    }
  }
  
  // Handle select menu interactions
  if (interaction.isStringSelectMenu()) {
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

    return;
  }

  // Catch-all: if we reach here, interaction was not handled
  console.warn(`[interactionCreate] ⚠️ Unhandled interaction: type=${interaction.type}, customId=${interaction.customId || 'N/A'}, commandName=${interaction.commandName || 'N/A'}`);
  if (!interaction.replied && !interaction.deferred) {
    try {
      await interaction.reply({ content: '⚠️ This action is not recognized. Please try again.', ephemeral: true });
    } catch (_) {}
  }

  } catch (globalErr) {
    // Top-level safety: ensure Discord always gets SOME response
    console.error(`[interactionCreate] ❌ UNCAUGHT ERROR:`, globalErr?.message, globalErr?.stack);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ An unexpected error occurred. Please try again.', ephemeral: true });
      } else if (interaction.deferred) {
        await interaction.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
      }
    } catch (_) {
      console.error('[interactionCreate] Could not send error response');
    }
  }
});

// Track messages from DCB workers for activity stats
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  // Push to backend (handles worker check there)
  pushToBackend('/api/internal/log-message', {
    guildId: message.guild.id,
    discordId: message.author.id
  });
  // Also log locally
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
      // Push to backend
      pushToBackend('/api/internal/log-online-time', { guildId, discordId: userId, minutes: mins });
      // Also log locally
      db.getWorker(guildId, userId).then(worker => {
        if (worker) {
          db.upsertWorkerDailyStat(guildId, userId, today, 'online_minutes', mins).catch(() => {});
        }
      }).catch(() => {});
    }
  }
});

// Gateway status monitoring
client.on('warn', (msg) => console.warn('[Discord WARN]', msg));
client.on('error', (err) => console.error('[Discord ERROR]', err?.message || err));
client.on('disconnect', () => console.error('[Discord] ❌ Disconnected from gateway!'));
client.on('reconnecting', () => console.log('[Discord] 🔄 Reconnecting to gateway...'));
client.on('invalidated', () => {
  console.error('[Discord] ❌ Session INVALIDATED — forcing restart');
  process.exit(1);
});
client.rest.on('rateLimited', (info) => {
  console.warn(`[Discord] ⏳ Rate limited: ${info.method} ${info.url} (retry after ${info.retryAfter}ms)`);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('[Discord] login failed:', err?.message || err);
});

// Start integrated API server (provides HTTP endpoints for the web UI)
try {
  console.log('[API] Starting API server...');
  require('./server/api')(client);
  console.log('[API] ✅ API server module loaded successfully');
} catch (err) {
  console.error('[API] ❌ Unable to start API server:', err.message);
  console.error('[API] Stack:', err.stack);
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
