const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('Check bot status and loaded commands'),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const client = interaction.client;
      const embed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle('🤖 DisCryptoBank Bot Status')
        .setDescription('Complete bot diagnostic information')
        .addFields(
          { name: '🟢 Bot Status', value: '✅ Online and Running' },
          { name: 'Bot Name', value: client.user.tag },
          { name: 'Bot ID', value: client.user.id },
          { name: '🎮 Current Status', value: `${client.user.presence?.activities[0]?.name || 'No status set'}` },
          { name: '📦 Commands Loaded', value: `${client.commands.size} commands` },
          { name: '🌍 Guilds', value: `${client.guilds.cache.size} servers` },
          { name: '⚙️ Command List', value: Array.from(client.commands.keys()).map(cmd => `\`/${cmd}\``).join(', ') || 'None loaded' },
          { name: '🔗 Current Guild', value: interaction.guild.name },
          { name: '👤 User', value: interaction.user.tag },
          { name: '⏰ Timestamp', value: new Date().toLocaleString() }
        )
        .setFooter({ text: 'Use /refresh-commands if new commands don\'t appear' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error getting bot status:', error);
      return interaction.editReply({
        content: `❌ Error: ${error.message}`
      });
    }
  }
};
