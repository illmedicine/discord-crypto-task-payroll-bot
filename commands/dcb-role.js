const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../utils/db');

const ROLE_NAMES = {
  admin: 'DCB Admin',
  staff: 'DCB Staff',
};

// Helper: ensure the Discord role exists in the guild, create if missing
async function ensureDiscordRole(guild, roleName) {
  let role = guild.roles.cache.find(r => r.name === roleName);
  if (!role) {
    const colors = { 'DCB Admin': 0xef4444, 'DCB Staff': 0x3b82f6 };
    role = await guild.roles.create({
      name: roleName,
      color: colors[roleName] || 0x94a3b8,
      reason: `Auto-created by DCB bot for worker management`,
      mentionable: true,
    });
  }
  return role;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dcb-role')
    .setDescription('Manage DCB Staff and Admin roles for worker tracking')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('assign')
        .setDescription('Assign a DCB role to a member')
        .addUserOption(opt => opt.setName('user').setDescription('Discord member').setRequired(true))
        .addStringOption(opt =>
          opt.setName('role')
            .setDescription('Role to assign')
            .setRequired(true)
            .addChoices(
              { name: 'DCB Staff', value: 'staff' },
              { name: 'DCB Admin', value: 'admin' },
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a member from DCB roles')
        .addUserOption(opt => opt.setName('user').setDescription('Discord member').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('promote')
        .setDescription('Promote a DCB Staff member to DCB Admin')
        .addUserOption(opt => opt.setName('user').setDescription('Discord member').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('demote')
        .setDescription('Demote a DCB Admin to DCB Staff')
        .addUserOption(opt => opt.setName('user').setDescription('Discord member').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all DCB workers in this guild')
    )
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Create DCB Staff and DCB Admin roles in this server')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const guild = interaction.guild;

    // ==================== SETUP ====================
    if (sub === 'setup') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const adminRole = await ensureDiscordRole(guild, 'DCB Admin');
        const staffRole = await ensureDiscordRole(guild, 'DCB Staff');
        const embed = new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle('✅ DCB Roles Created')
          .setDescription('The following roles are now available:')
          .addFields(
            { name: '🔴 DCB Admin', value: `<@&${adminRole.id}> — Full admin visibility on dashboard`, inline: true },
            { name: '🔵 DCB Staff', value: `<@&${staffRole.id}> — Staff worker tracking on dashboard`, inline: true },
          )
          .setFooter({ text: 'Use /dcb-role assign to add members' });
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply({ content: `❌ Failed to create roles: ${err.message}` });
      }
    }

    // ==================== ASSIGN ====================
    if (sub === 'assign') {
      await interaction.deferReply({ ephemeral: true });
      const targetUser = interaction.options.getUser('user');
      const roleType = interaction.options.getString('role');
      const roleName = ROLE_NAMES[roleType];

      try {
        const member = await guild.members.fetch(targetUser.id);
        const discordRole = await ensureDiscordRole(guild, roleName);
        await member.roles.add(discordRole, `DCB role assigned by ${interaction.user.tag}`);

        // Also remove the other DCB role if switching
        const otherRoleName = roleType === 'admin' ? 'DCB Staff' : 'DCB Admin';
        const otherRole = guild.roles.cache.find(r => r.name === otherRoleName);
        if (otherRole && member.roles.cache.has(otherRole.id)) {
          await member.roles.remove(otherRole, 'Switching DCB role');
        }

        await db.addWorker(guildId, targetUser.id, targetUser.username, roleType, interaction.user.id);
        await db.logWorkerActivity(guildId, targetUser.id, 'role_assigned', `Assigned ${roleName} by ${interaction.user.tag}`, null, null, null);

        const embed = new EmbedBuilder()
          .setColor(roleType === 'admin' ? 0xef4444 : 0x3b82f6)
          .setTitle(`${roleType === 'admin' ? '🔴' : '🔵'} ${roleName} Assigned`)
          .setDescription(`<@${targetUser.id}> has been assigned the **${roleName}** role.`)
          .addFields({ name: 'Assigned By', value: `<@${interaction.user.id}>`, inline: true })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply({ content: `❌ Failed to assign role: ${err.message}` });
      }
    }

    // ==================== REMOVE ====================
    if (sub === 'remove') {
      await interaction.deferReply({ ephemeral: true });
      const targetUser = interaction.options.getUser('user');

      try {
        const member = await guild.members.fetch(targetUser.id);
        for (const name of Object.values(ROLE_NAMES)) {
          const role = guild.roles.cache.find(r => r.name === name);
          if (role && member.roles.cache.has(role.id)) {
            await member.roles.remove(role, `DCB role removed by ${interaction.user.tag}`);
          }
        }
        await db.removeWorker(guildId, targetUser.id);
        await db.logWorkerActivity(guildId, targetUser.id, 'role_removed', `Removed from DCB roles by ${interaction.user.tag}`, null, null, null);

        return interaction.editReply({ content: `✅ <@${targetUser.id}> has been removed from all DCB roles.` });
      } catch (err) {
        return interaction.editReply({ content: `❌ Failed to remove role: ${err.message}` });
      }
    }

    // ==================== PROMOTE ====================
    if (sub === 'promote') {
      await interaction.deferReply({ ephemeral: true });
      const targetUser = interaction.options.getUser('user');

      try {
        const worker = await db.getWorker(guildId, targetUser.id);
        if (!worker) return interaction.editReply({ content: '❌ This user is not a DCB worker. Use `/dcb-role assign` first.' });
        if (worker.role === 'admin') return interaction.editReply({ content: '❌ This user is already a DCB Admin.' });

        const member = await guild.members.fetch(targetUser.id);
        const adminRole = await ensureDiscordRole(guild, 'DCB Admin');
        const staffRole = guild.roles.cache.find(r => r.name === 'DCB Staff');
        await member.roles.add(adminRole, `Promoted by ${interaction.user.tag}`);
        if (staffRole && member.roles.cache.has(staffRole.id)) await member.roles.remove(staffRole);

        await db.updateWorkerRole(guildId, targetUser.id, 'admin');
        await db.logWorkerActivity(guildId, targetUser.id, 'role_promoted', `Promoted to DCB Admin by ${interaction.user.tag}`, null, null, null);

        return interaction.editReply({ content: `🔴 <@${targetUser.id}> has been promoted to **DCB Admin**.` });
      } catch (err) {
        return interaction.editReply({ content: `❌ Failed to promote: ${err.message}` });
      }
    }

    // ==================== DEMOTE ====================
    if (sub === 'demote') {
      await interaction.deferReply({ ephemeral: true });
      const targetUser = interaction.options.getUser('user');

      try {
        const worker = await db.getWorker(guildId, targetUser.id);
        if (!worker) return interaction.editReply({ content: '❌ This user is not a DCB worker. Use `/dcb-role assign` first.' });
        if (worker.role === 'staff') return interaction.editReply({ content: '❌ This user is already DCB Staff.' });

        const member = await guild.members.fetch(targetUser.id);
        const staffRole = await ensureDiscordRole(guild, 'DCB Staff');
        const adminRole = guild.roles.cache.find(r => r.name === 'DCB Admin');
        await member.roles.add(staffRole, `Demoted by ${interaction.user.tag}`);
        if (adminRole && member.roles.cache.has(adminRole.id)) await member.roles.remove(adminRole);

        await db.updateWorkerRole(guildId, targetUser.id, 'staff');
        await db.logWorkerActivity(guildId, targetUser.id, 'role_demoted', `Demoted to DCB Staff by ${interaction.user.tag}`, null, null, null);

        return interaction.editReply({ content: `🔵 <@${targetUser.id}> has been demoted to **DCB Staff**.` });
      } catch (err) {
        return interaction.editReply({ content: `❌ Failed to demote: ${err.message}` });
      }
    }

    // ==================== LIST ====================
    if (sub === 'list') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const workers = await db.getGuildWorkers(guildId);
        if (!workers.length) {
          return interaction.editReply({ content: '📋 No DCB workers configured. Use `/dcb-role assign` to add members.' });
        }

        const admins = workers.filter(w => w.role === 'admin');
        const staff = workers.filter(w => w.role === 'staff');

        const embed = new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle('👥 DCB Workers')
          .setDescription(`**${workers.length}** worker${workers.length === 1 ? '' : 's'} configured in this server`)
          .setTimestamp();

        if (admins.length) {
          embed.addFields({
            name: `🔴 DCB Admins (${admins.length})`,
            value: admins.map(w => `<@${w.discord_id}> — since <t:${Math.floor(new Date(w.added_at).getTime() / 1000)}:R>`).join('\n'),
          });
        }
        if (staff.length) {
          embed.addFields({
            name: `🔵 DCB Staff (${staff.length})`,
            value: staff.map(w => `<@${w.discord_id}> — since <t:${Math.floor(new Date(w.added_at).getTime() / 1000)}:R>`).join('\n'),
          });
        }

        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply({ content: `❌ Failed to list workers: ${err.message}` });
      }
    }
  },
};
