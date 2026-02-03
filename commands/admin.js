const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin tools for bot management')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('fix-guild-ids')
        .setDescription('Fix guild_id mismatches for tasks and contests in this server')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('db-stats')
        .setDescription('View database statistics for this server')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const guildName = interaction.guild.name;

    // ==================== FIX GUILD IDs ====================
    if (subcommand === 'fix-guild-ids') {
      await interaction.deferReply({ ephemeral: true });

      try {
        // Fix guild_ids directly using raw SQL
        const results = {
          contests: 0,
          contestEntries: 0,
          bulkTasks: 0,
          taskAssignments: 0,
          proofSubmissions: 0
        };

        // Use promises for each update
        const updateContests = new Promise((resolve, reject) => {
          db.db.run(
            `UPDATE contests SET guild_id = ? WHERE guild_id != ?`,
            [guildId, guildId],
            function(err) {
              if (err) reject(err);
              else resolve(this.changes);
            }
          );
        });

        const updateContestEntries = new Promise((resolve, reject) => {
          db.db.run(
            `UPDATE contest_entries SET guild_id = ? WHERE guild_id != ?`,
            [guildId, guildId],
            function(err) {
              if (err) resolve(0); // Table may not exist
              else resolve(this.changes);
            }
          );
        });

        const updateBulkTasks = new Promise((resolve, reject) => {
          db.db.run(
            `UPDATE bulk_tasks SET guild_id = ? WHERE guild_id != ?`,
            [guildId, guildId],
            function(err) {
              if (err) reject(err);
              else resolve(this.changes);
            }
          );
        });

        const updateTaskAssignments = new Promise((resolve, reject) => {
          db.db.run(
            `UPDATE task_assignments SET guild_id = ? WHERE guild_id != ?`,
            [guildId, guildId],
            function(err) {
              if (err) resolve(0);
              else resolve(this.changes);
            }
          );
        });

        const updateProofSubmissions = new Promise((resolve, reject) => {
          db.db.run(
            `UPDATE proof_submissions SET guild_id = ? WHERE guild_id != ?`,
            [guildId, guildId],
            function(err) {
              if (err) resolve(0);
              else resolve(this.changes);
            }
          );
        });

        // Run all updates
        [
          results.contests,
          results.contestEntries,
          results.bulkTasks,
          results.taskAssignments,
          results.proofSubmissions
        ] = await Promise.all([
          updateContests,
          updateContestEntries,
          updateBulkTasks,
          updateTaskAssignments,
          updateProofSubmissions
        ]);

        const totalFixed = Object.values(results).reduce((a, b) => a + b, 0);

        const embed = new EmbedBuilder()
          .setColor(totalFixed > 0 ? '#00FF00' : '#FFA500')
          .setTitle('🔧 Guild ID Fix Results')
          .setDescription(`Fixed all records to use this server's guild_id.`)
          .addFields(
            { name: '🏠 Server', value: `${guildName}\n\`${guildId}\`` },
            { name: '🎉 Contests Fixed', value: results.contests.toString(), inline: true },
            { name: '📝 Contest Entries', value: results.contestEntries.toString(), inline: true },
            { name: '📋 Bulk Tasks', value: results.bulkTasks.toString(), inline: true },
            { name: '👤 Task Assignments', value: results.taskAssignments.toString(), inline: true },
            { name: '✅ Proof Submissions', value: results.proofSubmissions.toString(), inline: true },
            { name: '📊 Total Records Fixed', value: totalFixed.toString(), inline: true }
          )
          .setFooter({ text: totalFixed > 0 ? 'Records updated! Try your commands again.' : 'No mismatched records found.' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Fix guild IDs error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }

    // ==================== DB STATS ====================
    if (subcommand === 'db-stats') {
      await interaction.deferReply({ ephemeral: true });

      try {
        // Get counts from database
        const getCount = (table, whereClause = '') => {
          return new Promise((resolve, reject) => {
            const sql = `SELECT COUNT(*) as count FROM ${table} ${whereClause}`;
            db.db.get(sql, [], (err, row) => {
              if (err) resolve(0);
              else resolve(row?.count || 0);
            });
          });
        };

        const getGuildCount = (table) => {
          return new Promise((resolve, reject) => {
            db.db.get(
              `SELECT COUNT(*) as count FROM ${table} WHERE guild_id = ?`,
              [guildId],
              (err, row) => {
                if (err) resolve(0);
                else resolve(row?.count || 0);
              }
            );
          });
        };

        const getAllGuildIds = (table) => {
          return new Promise((resolve, reject) => {
            db.db.all(
              `SELECT DISTINCT guild_id FROM ${table}`,
              [],
              (err, rows) => {
                if (err) resolve([]);
                else resolve(rows?.map(r => r.guild_id) || []);
              }
            );
          });
        };

        // Gather stats
        const [
          totalContests,
          thisServerContests,
          contestGuilds,
          totalTasks,
          thisServerTasks,
          taskGuilds,
          totalUsers
        ] = await Promise.all([
          getCount('contests'),
          getGuildCount('contests'),
          getAllGuildIds('contests'),
          getCount('bulk_tasks'),
          getGuildCount('bulk_tasks'),
          getAllGuildIds('bulk_tasks'),
          getCount('users')
        ]);

        const mismatchedContests = totalContests - thisServerContests;
        const mismatchedTasks = totalTasks - thisServerTasks;

        let guildIdInfo = '**Contest Guild IDs:**\n';
        contestGuilds.forEach(g => {
          guildIdInfo += g === guildId ? `✅ \`${g}\` (this server)\n` : `⚠️ \`${g}\` (mismatch)\n`;
        });
        guildIdInfo += '\n**Task Guild IDs:**\n';
        taskGuilds.forEach(g => {
          guildIdInfo += g === guildId ? `✅ \`${g}\` (this server)\n` : `⚠️ \`${g}\` (mismatch)\n`;
        });

        const embed = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle('📊 Database Statistics')
          .addFields(
            { name: '🏠 This Server', value: `${guildName}\n\`${guildId}\`` },
            { name: '🎉 Contests', value: `Total: ${totalContests}\nThis server: ${thisServerContests}\n⚠️ Mismatched: ${mismatchedContests}`, inline: true },
            { name: '📋 Bulk Tasks', value: `Total: ${totalTasks}\nThis server: ${thisServerTasks}\n⚠️ Mismatched: ${mismatchedTasks}`, inline: true },
            { name: '👥 Total Users', value: totalUsers.toString(), inline: true },
            { name: '🔍 Guild IDs in Database', value: guildIdInfo || 'None' }
          )
          .setFooter({ text: mismatchedContests + mismatchedTasks > 0 ? 'Use /admin fix-guild-ids to fix mismatches' : 'All records match this server!' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('DB stats error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }
  }
};
