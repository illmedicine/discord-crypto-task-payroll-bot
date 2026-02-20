const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refresh-commands')
    .setDescription('🔄 Admin: Refresh slash commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Check if user is admin (Discord.js v14: use interaction.memberPermissions)
      if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply({
          content: '❌ You need Administrator permissions to use this command.'
        });
      }

      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('🔄 Refreshing Commands')
        .setDescription('Syncing all slash commands with Discord...')
        .addFields(
          { name: 'Status', value: '⏳ In progress...' }
        );

      await interaction.editReply({ embeds: [embed] });

      // Get all commands
      const client = interaction.client;
      const commands = [];
      
      for (const command of client.commands.values()) {
        commands.push(command.data.toJSON());
      }

      // Register commands globally
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

      const result = await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commands }
      );

      // Also register per-guild for instant update (no cache delay)
      let guildCount = 0;
      if (client.guilds?.cache?.size > 0) {
        for (const guild of client.guilds.cache.values()) {
          try {
            await rest.put(
              Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guild.id),
              { body: commands }
            );
            guildCount++;
          } catch (e) { /* skip guilds without permissions */ }
        }
      }

      const successEmbed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle('✅ Commands Refreshed Successfully')
        .setDescription(`All ${result.length} commands synced globally + ${guildCount} guild(s) updated instantly.`)
        .addFields(
          { name: 'Commands Registered', value: result.length.toString() },
          { name: 'Timestamp', value: new Date().toLocaleString() },
          { name: '⏱️ Note', value: 'Commands may take 5-15 minutes to appear in Discord. Try typing `/` to see the updated list.' }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
      console.error('Error refreshing commands:', error);

      const errorEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Refresh Failed')
        .setDescription(error.message)
        .addFields(
          { name: 'Error Type', value: error.name || 'Unknown' },
          { name: 'Check', value: '• Verify bot has admin permissions\n• Check DISCORD_TOKEN is valid\n• Check DISCORD_CLIENT_ID is correct' }
        );

      return interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};
