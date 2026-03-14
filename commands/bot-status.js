const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

      // Permission health check
      const REQUIRED_PERMS = [
        { flag: 'SendMessages', label: 'Send Messages' },
        { flag: 'EmbedLinks', label: 'Embed Links' },
        { flag: 'ReadMessageHistory', label: 'Read Message History' },
        { flag: 'Connect', label: 'Connect (Voice)' },
        { flag: 'Speak', label: 'Speak (Voice)' },
        { flag: 'UseVAD', label: 'Use Voice Activity' },
      ];
      const me = interaction.guild?.members?.me;
      const permLines = me
        ? REQUIRED_PERMS.map(p => `${me.permissions.has(p.flag) ? '✅' : '❌'} ${p.label}`).join('\n')
        : '(could not check)';
      const missingPerms = me ? REQUIRED_PERMS.filter(p => !me.permissions.has(p.flag)) : [];

      const embed = new EmbedBuilder()
        .setColor(missingPerms.length > 0 ? '#ff9800' : '#14F195')
        .setTitle('🤖 DisCryptoBank Bot Status')
        .setDescription(`**v${VERSION}** • commit \`${GIT_COMMIT_SHORT}\``)
        .addFields(
          { name: '🟢 Status', value: '✅ Online', inline: true },
          { name: '⏱️ Uptime', value: uptimeStr, inline: true },
          { name: '🌍 Servers', value: `${client.guilds.cache.size}`, inline: true },
          { name: '📦 Commands', value: `${client.commands.size} loaded`, inline: true },
          { name: '🔗 This Server', value: interaction.guild?.name || 'DM', inline: true },
          { name: '📅 Last Deploy', value: GIT_COMMIT_DATE || 'Unknown', inline: true },
          { name: '🔑 Permissions', value: permLines },
          { name: '🔧 Latest Fix', value: GIT_LATEST_MSG || '(none)' },
          { name: '📋 Recent Changes', value: changelog.slice(0, 1024) },
          { name: '⚙️ Commands', value: Array.from(client.commands.keys()).map(c => `\`/${c}\``).join(', ') || 'None' }
        )
        .setFooter({ text: `DisCryptoBank v${VERSION} • ${GIT_COMMIT_SHORT}` })
        .setTimestamp();

      const components = [];
      if (missingPerms.length > 0) {
        const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=2184267776&scope=bot%20applications.commands`;
        components.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('🔄 Update Bot Permissions')
            .setStyle(ButtonStyle.Link)
            .setURL(inviteUrl)
        ));
      }

      return interaction.editReply({ embeds: [embed], components });

    } catch (error) {
      console.error('Error getting bot status:', error);
      return interaction.editReply({
        content: `❌ Error: ${error.message}`
      });
    }
  }
};
