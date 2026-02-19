const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Read git info once at module load
let VERSION = '?';
let GIT_COMMIT_SHORT = '?';
let GIT_COMMIT_DATE = '?';
let GIT_LATEST_MSG = '';
let GIT_RECENT = [];
try {
  VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
  const { execSync } = require('child_process');
  const cwd = path.join(__dirname, '..');
  GIT_COMMIT_SHORT = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf8' }).trim();
  GIT_COMMIT_DATE = execSync('git log -1 --format=%ci', { cwd, encoding: 'utf8' }).trim();
  GIT_LATEST_MSG = execSync('git log -1 --format=%s', { cwd, encoding: 'utf8' }).trim();
  GIT_RECENT = execSync('git log -8 --format=• %s', { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch (_) {}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('Check bot status, version, and recent changes'),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const client = interaction.client;
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const uptimeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

      const changelog = GIT_RECENT.length > 0
        ? GIT_RECENT.join('\n')
        : '(no git history available)';

      const embed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle('🤖 DisCryptoBank Bot Status')
        .setDescription(`**v${VERSION}** • commit \`${GIT_COMMIT_SHORT}\``)
        .addFields(
          { name: '🟢 Status', value: '✅ Online', inline: true },
          { name: '⏱️ Uptime', value: uptimeStr, inline: true },
          { name: '🌍 Servers', value: `${client.guilds.cache.size}`, inline: true },
          { name: '📦 Commands', value: `${client.commands.size} loaded`, inline: true },
          { name: '🔗 This Server', value: interaction.guild?.name || 'DM', inline: true },
          { name: '📅 Last Deploy', value: GIT_COMMIT_DATE || 'Unknown', inline: true },
          { name: '🔧 Latest Fix', value: GIT_LATEST_MSG || '(none)' },
          { name: '📋 Recent Changes', value: changelog.slice(0, 1024) },
          { name: '⚙️ Commands', value: Array.from(client.commands.keys()).map(c => `\`/${c}\``).join(', ') || 'None' }
        )
        .setFooter({ text: `DisCryptoBank v${VERSION} • ${GIT_COMMIT_SHORT}` })
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
