const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const musicPlayer = require('../utils/musicPlayer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Server music player — play songs for the voice channel')
    .addSubcommand(sub =>
      sub.setName('play')
        .setDescription('Play a song or playlist from a URL or search query')
        .addStringOption(opt =>
          opt.setName('query')
            .setDescription('YouTube / SoundCloud / Spotify URL or playlist link, or search text')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('pause')
        .setDescription('Pause the current track'))
    .addSubcommand(sub =>
      sub.setName('resume')
        .setDescription('Resume playback'))
    .addSubcommand(sub =>
      sub.setName('skip')
        .setDescription('Skip to the next track'))
    .addSubcommand(sub =>
      sub.setName('stop')
        .setDescription('Stop playback and disconnect the bot'))
    .addSubcommand(sub =>
      sub.setName('queue')
        .setDescription('Show the current queue'))
    .addSubcommand(sub =>
      sub.setName('nowplaying')
        .setDescription('Show the currently playing track'))
    .addSubcommand(sub =>
      sub.setName('loop')
        .setDescription('Toggle looping the current track'))
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Clear all tracks from the queue'))
    .addSubcommand(sub =>
      sub.setName('mute')
        .setDescription('Mute/unmute the music on YOUR end only (server-deafens you)'))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a track from the queue by position')
        .addIntegerOption(opt =>
          opt.setName('position')
            .setDescription('Position in queue (1-based)')
            .setRequired(true)
            .setMinValue(1))),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // ── play ──
    if (subcommand === 'play') {
      const query = interaction.options.getString('query');

      // User must be in a voice channel
      const member = interaction.member;
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: '❌ You need to be in a voice channel to play music.', ephemeral: true });
      }

      await interaction.deferReply();

      // Resolve the URL / search query
      const { tracks, error } = await musicPlayer.resolveQuery(query);
      if (error || tracks.length === 0) {
        return interaction.editReply({ content: `❌ Could not find any tracks: ${error || 'No results.'}` });
      }

      // Tag each track with who requested it
      for (const t of tracks) {
        t.requestedBy = interaction.user.username;
      }

      // Get or create guild player and queue tracks
      let state = musicPlayer.getGuildPlayer(guildId);
      const wasEmpty = !state || (!state.current && state.queue.length === 0);

      if (!state) {
        // First time — create state, add tracks, then connect
        const { guildPlayers, createGuildPlayer: _create } = musicPlayer;
        state = musicPlayer.getGuildPlayer(guildId);
        if (!state) {
          // createGuildPlayer is internal, so manually create and register
          const { createAudioPlayer: _cap } = require('@discordjs/voice');
          state = {
            player: _cap(),
            connection: null,
            queue: [],
            current: null,
            loop: false,
            textChannelId: interaction.channelId,
          };
          guildPlayers.set(guildId, state);
        }
        state.queue.push(...tracks);
        await musicPlayer.connectAndPlay(
          guildId,
          voiceChannel.id,
          interaction.guild.voiceAdapterCreator,
          interaction.channelId,
          interaction.client
        );
      } else {
        // Already connected — add to queue
        state.queue.push(...tracks);
        state.textChannelId = interaction.channelId;
        if (wasEmpty) {
          if (!state.connection) {
            await musicPlayer.connectAndPlay(
              guildId,
              voiceChannel.id,
              interaction.guild.voiceAdapterCreator,
              interaction.channelId,
              interaction.client
            );
          } else {
            musicPlayer.skip(guildId, interaction.client); // triggers playNext
          }
        }
      }

      const embed = new EmbedBuilder()
        .setColor('#1DB954')
        .setTitle(tracks.length === 1 ? '🎵 Added to Queue' : `🎵 Added ${tracks.length} Tracks`)
        .setDescription(tracks.length === 1
          ? `**${tracks[0].title}** (${tracks[0].duration})`
          : `From playlist — first track: **${tracks[0].title}**`)
        .setFooter({ text: `Requested by ${interaction.user.username}` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_pause').setLabel('⏸ Pause').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_skip').setLabel('⏭ Skip').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_stop').setLabel('⏹ Stop').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('music_mute').setLabel('🔇 Mute Me').setStyle(ButtonStyle.Secondary),
      );

      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    // ── pause ──
    if (subcommand === 'pause') {
      musicPlayer.pause(guildId);
      return interaction.reply({ content: '⏸ Music paused.', ephemeral: false });
    }

    // ── resume ──
    if (subcommand === 'resume') {
      musicPlayer.resume(guildId);
      return interaction.reply({ content: '▶️ Music resumed.', ephemeral: false });
    }

    // ── skip ──
    if (subcommand === 'skip') {
      musicPlayer.skip(guildId, interaction.client);
      return interaction.reply({ content: '⏭ Skipped to next track.', ephemeral: false });
    }

    // ── stop ──
    if (subcommand === 'stop') {
      musicPlayer.disconnect(guildId);
      return interaction.reply({ content: '⏹ Music stopped and disconnected.', ephemeral: false });
    }

    // ── queue ──
    if (subcommand === 'queue') {
      const state = musicPlayer.getState(guildId);
      if (!state.current && state.queue.length === 0) {
        return interaction.reply({ content: '📭 Queue is empty. Use `/music play` to add tracks.', ephemeral: true });
      }

      let desc = '';
      if (state.current) {
        desc += `**Now Playing:** ${state.current.title} (${state.current.duration})\n\n`;
      }
      if (state.queue.length > 0) {
        desc += '**Up Next:**\n';
        state.queue.slice(0, 15).forEach((t, i) => {
          desc += `${i + 1}. ${t.title} (${t.duration}) — *${t.requestedBy || '?'}*\n`;
        });
        if (state.queue.length > 15) {
          desc += `\n... and ${state.queue.length - 15} more`;
        }
      }

      const embed = new EmbedBuilder()
        .setColor('#1DB954')
        .setTitle('🎶 Music Queue')
        .setDescription(desc)
        .addFields({ name: 'Loop', value: state.loop ? '🔁 On' : '➡️ Off', inline: true })
        .setFooter({ text: `${state.queue.length} track(s) in queue` });

      return interaction.reply({ embeds: [embed] });
    }

    // ── nowplaying ──
    if (subcommand === 'nowplaying') {
      const state = musicPlayer.getState(guildId);
      if (!state.current) {
        return interaction.reply({ content: '🔇 Nothing is currently playing.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor('#1DB954')
        .setTitle('🎵 Now Playing')
        .setDescription(`**${state.current.title}**`)
        .addFields(
          { name: 'Duration', value: state.current.duration, inline: true },
          { name: 'Requested By', value: state.current.requestedBy || 'Unknown', inline: true },
          { name: 'Loop', value: state.loop ? '🔁 On' : '➡️ Off', inline: true },
          { name: 'Queue', value: `${state.queue.length} track(s)`, inline: true },
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_pause').setLabel('⏸ Pause').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_skip').setLabel('⏭ Skip').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_stop').setLabel('⏹ Stop').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('music_mute').setLabel('🔇 Mute Me').setStyle(ButtonStyle.Secondary),
      );

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // ── loop ──
    if (subcommand === 'loop') {
      const state = musicPlayer.getState(guildId);
      const newLoop = !state.loop;
      musicPlayer.setLoop(guildId, newLoop);
      return interaction.reply({ content: newLoop ? '🔁 Loop **enabled** — current track will repeat.' : '➡️ Loop **disabled**.' });
    }

    // ── clear ──
    if (subcommand === 'clear') {
      musicPlayer.clearQueue(guildId);
      return interaction.reply({ content: '🗑️ Queue cleared. Current track still playing.' });
    }

    // ── mute (personal) ──
    if (subcommand === 'mute') {
      const member = interaction.member;
      if (!member?.voice?.channel) {
        return interaction.reply({ content: '❌ You\'re not in a voice channel.', ephemeral: true });
      }
      const isDeafened = member.voice.selfDeaf;
      try {
        // Toggle self-deafen via server (the bot can server-deafen members)
        await member.voice.setDeaf(!isDeafened);
        return interaction.reply({
          content: !isDeafened
            ? '🔇 You are now **deafened** — you won\'t hear the music. Others still hear it.\nUse `/music mute` again to unmute.'
            : '🔊 You are now **undeafened** — you can hear the music again.',
          ephemeral: true
        });
      } catch (err) {
        // Fallback: bot may not have permission to server-deafen
        return interaction.reply({
          content: '💡 I can\'t deafen you automatically. **Right-click your name** in the voice channel → **Deafen** to mute the music on your end. Or click the headphone icon at the bottom of Discord.',
          ephemeral: true
        });
      }
    }

    // ── remove ──
    if (subcommand === 'remove') {
      const pos = interaction.options.getInteger('position');
      const removed = musicPlayer.removeFromQueue(guildId, pos - 1);
      if (removed) {
        return interaction.reply({ content: `🗑️ Removed **${removed.title}** from position ${pos}.` });
      }
      return interaction.reply({ content: `❌ No track at position ${pos}.`, ephemeral: true });
    }
  },

  // ── Button handlers (called from index.js) ──
  async handleMusicButton(interaction) {
    const guildId = interaction.guildId;
    const action = interaction.customId.replace('music_', '');

    if (action === 'pause') {
      const state = musicPlayer.getState(guildId);
      if (state.paused) {
        musicPlayer.resume(guildId);
        return interaction.reply({ content: '▶️ Music resumed.', ephemeral: false });
      } else {
        musicPlayer.pause(guildId);
        return interaction.reply({ content: '⏸ Music paused.', ephemeral: false });
      }
    }

    if (action === 'skip') {
      musicPlayer.skip(guildId, interaction.client);
      return interaction.reply({ content: '⏭ Skipped.', ephemeral: false });
    }

    if (action === 'stop') {
      musicPlayer.disconnect(guildId);
      return interaction.reply({ content: '⏹ Music stopped.', ephemeral: false });
    }

    if (action === 'mute') {
      const member = interaction.member;
      if (!member?.voice?.channel) {
        return interaction.reply({ content: '❌ You\'re not in a voice channel.', ephemeral: true });
      }
      const isDeafened = member.voice.selfDeaf;
      try {
        await member.voice.setDeaf(!isDeafened);
        return interaction.reply({
          content: !isDeafened
            ? '🔇 You are now **deafened** — music is muted for you. Others still hear it.\nClick 🔇 again to unmute.'
            : '🔊 You are now **undeafened** — you can hear the music again.',
          ephemeral: true
        });
      } catch {
        return interaction.reply({
          content: '💡 Right-click your name in the voice channel → **Deafen** to mute the music for yourself.',
          ephemeral: true
        });
      }
    }

    // Queue button from web UI
    if (action === 'queue') {
      const state = musicPlayer.getState(guildId);
      if (!state.current && state.queue.length === 0) {
        return interaction.reply({ content: '📭 Queue is empty.', ephemeral: true });
      }
      let desc = '';
      if (state.current) desc += `**Now Playing:** ${state.current.title}\n\n`;
      state.queue.slice(0, 10).forEach((t, i) => { desc += `${i + 1}. ${t.title}\n`; });
      return interaction.reply({ content: desc, ephemeral: true });
    }
  },
};
