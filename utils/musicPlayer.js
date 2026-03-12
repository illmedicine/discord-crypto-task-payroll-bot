/**
 * Music Player Engine for DCB Bot
 * 
 * Manages voice connections, audio streaming, and per-guild queues.
 * Supports YouTube, SoundCloud, Spotify URLs and playlists via play-dl.
 * 
 * "Personal mute" is handled client-side — Discord doesn't support
 * per-user audio muting from a bot. Users deafen themselves via
 * the /music mute command (which server-deafens them) or by using
 * Discord's built-in self-deafen. The bot always plays for everyone.
 */

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, getVoiceConnection } = require('@discordjs/voice');
const play = require('play-dl');

// Per-guild state: { player, connection, queue[], current, loop, volume, textChannelId }
const guildPlayers = new Map();

function getGuildPlayer(guildId) {
  return guildPlayers.get(guildId) || null;
}

function createGuildPlayer(guildId) {
  const player = createAudioPlayer();
  const state = {
    player,
    connection: null,
    queue: [],      // [{ title, url, duration, requestedBy }]
    current: null,
    loop: false,
    textChannelId: null,
  };
  guildPlayers.set(guildId, state);
  return state;
}

/**
 * Resolve a URL or search query into playable track(s).
 * Accepts: YouTube video/playlist, SoundCloud track/playlist, Spotify track/playlist/album, or search text.
 */
async function resolveQuery(query) {
  const tracks = [];

  // Validate URL format to prevent SSRF — only allow known music domains
  if (/^https?:\/\//i.test(query)) {
    try {
      const parsed = new URL(query);
      const allowed = ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
        'music.youtube.com', 'soundcloud.com', 'www.soundcloud.com',
        'open.spotify.com', 'spotify.com'];
      if (!allowed.some(d => parsed.hostname === d)) {
        return { tracks: [], error: 'Only YouTube, SoundCloud, and Spotify URLs are supported.' };
      }
    } catch {
      return { tracks: [], error: 'Invalid URL format.' };
    }
  }

  try {
    const validated = await play.validate(query);

    if (validated === 'yt_video') {
      const info = await play.video_info(query);
      tracks.push({
        title: info.video_details.title,
        url: query,
        duration: info.video_details.durationRaw || '?',
        requestedBy: null,
      });
    } else if (validated === 'yt_playlist') {
      try {
        const playlist = await play.playlist_info(query, { incomplete: true });
        const videos = await playlist.all_videos();
        for (const v of videos.slice(0, 100)) { // cap at 100 tracks
          tracks.push({
            title: v.title,
            url: v.url,
            duration: v.durationRaw || '?',
            requestedBy: null,
          });
        }
      } catch (plErr) {
        // YouTube Mix/Radio playlists often fail — fall back to the video in the URL
        console.warn('[MusicPlayer] Playlist parse failed, trying as single video:', plErr.message);
        const videoUrl = query.replace(/[&?]list=[^&]*/g, '').replace(/[&?]start_radio=[^&]*/g, '').replace(/[&?]index=[^&]*/g, '');
        try {
          const info = await play.video_info(videoUrl);
          tracks.push({
            title: info.video_details.title,
            url: videoUrl,
            duration: info.video_details.durationRaw || '?',
            requestedBy: null,
          });
        } catch (vErr) {
          console.error('[MusicPlayer] Video fallback also failed:', vErr.message);
          return { tracks: [], error: `Playlist and video lookup both failed: ${plErr.message}` };
        }
      }
    } else if (validated === 'so_track') {
      const info = await play.soundcloud(query);
      tracks.push({
        title: info.name,
        url: info.url,
        duration: info.durationRaw || '?',
        requestedBy: null,
      });
    } else if (validated === 'so_playlist') {
      const playlist = await play.soundcloud(query);
      const items = playlist.tracks || [];
      for (const t of items.slice(0, 100)) {
        tracks.push({
          title: t.name,
          url: t.url,
          duration: t.durationRaw || '?',
          requestedBy: null,
        });
      }
    } else if (validated === 'sp_track' || validated === 'sp_album' || validated === 'sp_playlist') {
      // Spotify → search on YouTube for each track
      if (validated === 'sp_track') {
        const sp = await play.spotify(query);
        const searched = await play.search(`${sp.name} ${sp.artists?.map(a => a.name).join(' ') || ''}`, { limit: 1, source: { youtube: 'video' } });
        if (searched.length > 0) {
          tracks.push({
            title: sp.name,
            url: searched[0].url,
            duration: searched[0].durationRaw || '?',
            requestedBy: null,
          });
        }
      } else {
        const sp = await play.spotify(query);
        const items = await sp.all_tracks();
        for (const t of items.slice(0, 50)) { // cap at 50 for Spotify playlists
          try {
            const searched = await play.search(`${t.name} ${t.artists?.map(a => a.name).join(' ') || ''}`, { limit: 1, source: { youtube: 'video' } });
            if (searched.length > 0) {
              tracks.push({
                title: t.name,
                url: searched[0].url,
                duration: searched[0].durationRaw || '?',
                requestedBy: null,
              });
            }
          } catch { /* skip failed lookups */ }
        }
      }
    } else {
      // Search YouTube by text
      const results = await play.search(query, { limit: 1, source: { youtube: 'video' } });
      if (results.length > 0) {
        tracks.push({
          title: results[0].title,
          url: results[0].url,
          duration: results[0].durationRaw || '?',
          requestedBy: null,
        });
      }
    }
  } catch (err) {
    console.error('[MusicPlayer] resolveQuery error:', err.message);
    return { tracks: [], error: err.message };
  }

  return { tracks, error: null };
}

/**
 * Stream a track URL into an AudioResource.
 */
async function createStreamResource(url) {
  const stream = await play.stream(url);
  return createAudioResource(stream.stream, { inputType: stream.type });
}

/**
 * Play the next track in the guild queue.
 */
async function playNext(guildId, client) {
  const state = guildPlayers.get(guildId);
  if (!state) return;

  if (state.queue.length === 0) {
    state.current = null;
    // Auto-disconnect after 2 min idle
    setTimeout(() => {
      const s = guildPlayers.get(guildId);
      if (s && !s.current && s.queue.length === 0) {
        disconnect(guildId);
      }
    }, 120_000);
    return;
  }

  const track = state.queue.shift();
  state.current = track;

  try {
    const resource = await createStreamResource(track.url);
    state.player.play(resource);

    // Notify text channel
    if (state.textChannelId && client) {
      try {
        const channel = await client.channels.fetch(state.textChannelId);
        if (channel) {
          const { EmbedBuilder } = require('discord.js');
          const embed = new EmbedBuilder()
            .setColor('#1DB954')
            .setTitle('🎵 Now Playing')
            .setDescription(`**${track.title}**`)
            .addFields(
              { name: 'Duration', value: track.duration, inline: true },
              { name: 'Requested By', value: track.requestedBy || 'Unknown', inline: true },
              { name: 'Queue', value: `${state.queue.length} track(s) remaining`, inline: true }
            )
            .setFooter({ text: 'Use /music mute to stop hearing music on your end' });
          channel.send({ embeds: [embed] }).catch(() => {});
        }
      } catch {}
    }
  } catch (err) {
    console.error(`[MusicPlayer] Error playing ${track.title}:`, err.message);
    // Skip to next
    playNext(guildId, client);
  }
}

/**
 * Connect to a voice channel and start playing.
 */
async function connectAndPlay(guildId, channelId, adapterCreator, textChannelId, client) {
  let state = guildPlayers.get(guildId);
  if (!state) {
    state = createGuildPlayer(guildId);
  }
  state.textChannelId = textChannelId;

  // Remove old listeners to prevent accumulation on reconnect
  state.player.removeAllListeners(AudioPlayerStatus.Idle);
  state.player.removeAllListeners('error');

  // Join voice channel
  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator,
    selfDeaf: true,
  });

  state.connection = connection;

  // Subscribe the connection to the audio player
  connection.subscribe(state.player);

  // Handle player idle (track finished)
  state.player.on(AudioPlayerStatus.Idle, () => {
    if (state.loop && state.current) {
      state.queue.unshift(state.current); // re-add for loop
    }
    playNext(guildId, client);
  });

  // Handle errors
  state.player.on('error', (error) => {
    console.error(`[MusicPlayer] Player error in ${guildId}:`, error.message);
    playNext(guildId, client);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      cleanup(guildId);
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    cleanup(guildId);
  });

  // Start playback if there are tracks queued
  if (state.queue.length > 0) {
    playNext(guildId, client);
  }
}

function disconnect(guildId) {
  const state = guildPlayers.get(guildId);
  if (state) {
    state.player.stop(true);
    if (state.connection) {
      try { state.connection.destroy(); } catch {}
    }
    cleanup(guildId);
  }
}

function cleanup(guildId) {
  const state = guildPlayers.get(guildId);
  if (state) {
    state.current = null;
    state.queue = [];
    state.connection = null;
  }
  guildPlayers.delete(guildId);
}

/**
 * Get current state for API / web UI.
 */
function getState(guildId) {
  const state = guildPlayers.get(guildId);
  if (!state) return { playing: false, current: null, queue: [], loop: false };
  return {
    playing: state.player.state.status === AudioPlayerStatus.Playing,
    paused: state.player.state.status === AudioPlayerStatus.Paused,
    current: state.current,
    queue: state.queue.slice(0, 50),
    loop: state.loop,
  };
}

function pause(guildId) {
  const state = guildPlayers.get(guildId);
  if (state) state.player.pause();
}

function resume(guildId) {
  const state = guildPlayers.get(guildId);
  if (state) state.player.unpause();
}

function skip(guildId, client) {
  const state = guildPlayers.get(guildId);
  if (state) state.player.stop(); // triggers Idle → playNext
}

function setLoop(guildId, enabled) {
  const state = guildPlayers.get(guildId);
  if (state) state.loop = enabled;
}

function clearQueue(guildId) {
  const state = guildPlayers.get(guildId);
  if (state) state.queue = [];
}

function removeFromQueue(guildId, index) {
  const state = guildPlayers.get(guildId);
  if (state && index >= 0 && index < state.queue.length) {
    return state.queue.splice(index, 1)[0];
  }
  return null;
}

module.exports = {
  resolveQuery,
  connectAndPlay,
  disconnect,
  getState,
  getGuildPlayer,
  pause,
  resume,
  skip,
  setLoop,
  clearQueue,
  removeFromQueue,
  guildPlayers,
};
