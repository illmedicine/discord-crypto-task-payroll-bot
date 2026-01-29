const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('diagnose')
    .setDescription('Diagnostic tool to check command loading'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const client = interaction.client;
      const commandsPath = path.join(__dirname, '..');
      
      // Get all command files
      const commandFiles = fs.readdirSync(path.join(commandsPath, 'commands')).filter(file => file.endsWith('.js'));
      
      // Try to load each command and check for errors
      const commandStatus = {};
      const errors = [];
      
      for (const file of commandFiles) {
        try {
          const filePath = path.join(commandsPath, 'commands', file);
          const command = require(filePath);
          
          if ('data' in command && 'execute' in command) {
            commandStatus[file] = {
              name: command.data.name,
              valid: true,
              error: null
            };
          } else {
            commandStatus[file] = {
              valid: false,
              error: 'Missing data or execute'
            };
            errors.push(file);
          }
        } catch (err) {
          commandStatus[file] = {
            valid: false,
            error: err.message
          };
          errors.push(file);
        }
      }

      // Build diagnostic embed
      const diagnosticEmbed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('🔍 Bot Diagnostic Report')
        .addFields(
          { name: '🤖 Bot Status', value: '✅ Online' },
          { name: '📂 Command Files Found', value: commandFiles.length.toString() },
          { name: '✅ Commands Loaded in Bot', value: client.commands.size.toString() },
          { name: '⚠️ Loading Errors', value: errors.length.toString() }
        );

      // Add loaded commands
      const loadedCommands = Array.from(client.commands.keys())
        .map(cmd => `\`/${cmd}\``)
        .join(', ');
      
      diagnosticEmbed.addFields(
        { name: '📋 Loaded Commands in Bot Memory', value: loadedCommands || 'None' }
      );

      // Add file status
      let fileStatus = '';
      for (const [file, status] of Object.entries(commandStatus)) {
        if (status.valid) {
          fileStatus += `✅ ${file}\n`;
        } else {
          fileStatus += `❌ ${file}: ${status.error}\n`;
        }
      }
      
      diagnosticEmbed.addFields(
        { name: '📄 File Status', value: fileStatus || 'No files' }
      );

      diagnosticEmbed.addFields(
        { name: '🆘 Troubleshooting', value: 
          errors.length > 0 
            ? `Check Railway logs for: "${errors.join(', ')}"`
            : 'All command files are valid. Issue may be with Discord sync.'
        }
      );

      diagnosticEmbed.setFooter({ text: 'If /user-wallet is missing, check Railway logs' });

      return interaction.editReply({ embeds: [diagnosticEmbed] });

    } catch (error) {
      console.error('Diagnostic error:', error);
      return interaction.editReply({
        content: `❌ Diagnostic error: ${error.message}`
      });
    }
  }
};
