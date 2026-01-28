const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const crypto = require('./utils/crypto');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Command collection
client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`✅ Command loaded: ${command.data.name}`);
  }
}

// Register slash commands
const commands = [];
for (const command of client.commands.values()) {
  commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Commands registered successfully');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
})();

// Bot ready event
client.once('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  console.log(`🌐 Connected to Solana: ${process.env.SOLANA_RPC_URL}`);
  console.log(`💰 Wallet: ${crypto.getWallet()?.publicKey.toString()}`);
  console.log(`📡 LivePay Solana Payroll Engine is LIVE`);
});

// Interaction handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error('❌ Error executing command:', error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '❌ An error occurred executing this command.', ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ An error occurred executing this command.', ephemeral: true });
    }
  }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
