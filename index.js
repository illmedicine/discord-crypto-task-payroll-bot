const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const crypto = require('./utils/crypto');

// Version and build info
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
const BUILD_DATE = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const LATEST_FEATURES = [
  'Auto wallet lookup on /pay',
  '/user-wallet command',
  'USD to SOL conversion',
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
client.once('ready', async () => {
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
      console.log(`⚡ About to execute: ${interaction.commandName}`);
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
    }
    return;
  }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
