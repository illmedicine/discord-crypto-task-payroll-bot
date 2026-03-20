const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/db');
const { gatherPrestigeStats, calcPrestige, TIER_CONFIG } = require('../utils/prestige');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('prestige')
    .setDescription('View your DCB Prestige Badge — tier grade based on platform activity')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Check another user\'s prestige (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const target = interaction.options.getUser('user') || interaction.user;
    const stats = await gatherPrestigeStats(db, target.id);
    const result = calcPrestige(stats);
    const cfg = result.config;
    const bd = result.breakdown;

    // Build a visual progress bar
    const filled = Math.round(result.score / 5);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);

    const embed = new EmbedBuilder()
      .setColor(cfg.color)
      .setAuthor({ name: `${target.displayName || target.username}`, iconURL: target.displayAvatarURL({ size: 64 }) })
      .setTitle(`${cfg.emoji} ${result.tier}-Tier — ${cfg.title}`)
      .setDescription(
        `**Prestige Score: ${result.score}/100**\n` +
        `\`${bar}\` ${result.score}%\n\n` +
        `> *Prestige recognizes the most active DCB users.*\n` +
        `> *Use the bot, join events, and climb the tiers!*`
      )
      .addFields(
        { name: '🏇 Race Bets', value: `${stats.raceBets} placed → +${bd.raceBets}pts`, inline: true },
        { name: '🏆 Race Wins', value: `${stats.raceWins} wins → +${bd.raceWins}pts`, inline: true },
        { name: '🗳️ Vote Events', value: `${stats.voteJoins} joined → +${bd.voteJoins}pts`, inline: true },
        { name: '🃏 Poker', value: `${stats.pokerPlayed} played → +${bd.pokerPlayed}pts`, inline: true },
        { name: '📋 Events Created', value: `${stats.eventsCreated} created → +${bd.eventsCreated}pts`, inline: true },
        { name: '⌨️ Commands', value: `${stats.commands} run → +${bd.commands}pts`, inline: true },
        { name: '📅 Tenure', value: `${stats.tenureDays} days → +${bd.tenure}pts`, inline: true },
        { name: '💳 Wallet', value: `${stats.hasWallet ? '✅' : '❌'} Wallet ${stats.hasAutoPayKey ? '+ ✅ Auto-Pay' : ''} → +${bd.wallet}pts`, inline: true },
      )
      .setFooter({ text: 'DCB Prestige • S ≥ 90 • A ≥ 65 • B ≥ 40 • C ≥ 20 • D < 20' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
