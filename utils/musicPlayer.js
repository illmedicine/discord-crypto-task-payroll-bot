/**
 * Music Player Engine for DCB Bot
 * 
 * Manages voice connections, audio streaming, and per-guild queues.
 * Supports YouTube URLs/playlists via @distube/ytdl-core + youtube-sr,
 * with play-dl as optional fallback for SoundCloud/Spotify.
 */

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, getVoiceConnection, StreamType } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;

// Optional: keep play-dl for SoundCloud/Spotify metadata
let playDl;
try { playDl = require('play-dl'); } catch (e) { console.warn('[MusicPlayer] play-dl not available — SoundCloud/Spotify support disabled'); }

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

  // Helper to format seconds to m:ss or h:mm:ss
  function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '?';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }

  try {
    const isYouTube = /^https?:\/\/(www\.|m\.|music\.)?youtu(\.be|be\.com)\//i.test(query);
    const isSoundCloud = /^https?:\/\/(www\.)?soundcloud\.com\//i.test(query);
    const isSpotify = /^https?:\/\/(open\.)?spotify\.com\//i.test(query);
    const isUrl = /^https?:\/\//i.test(query);

    if (isYouTube && /[?&]list=/.test(query)) {
      // YouTube playlist
      try {
        const playlist = await YouTube.getPlaylist(query, { fetchAll: true });
        const videos = playlist.videos || [];
        for (const v of videos.slice(0, 100)) {
          tracks.push({
            title: v.title || 'Unknown',
            url: `https://www.youtube.com/watch?v=${v.id}`,
            duration: formatDuration(v.duration / 1000),
            requestedBy: null,
          });
        }
      } catch (plErr) {
        console.warn('[MusicPlayer] Playlist parse failed, trying as single video:', plErr.message);
        const videoUrl = query.replace(/[&?]list=[^&]*/g, '').replace(/[&?]start_radio=[^&]*/g, '').replace(/[&?]index=[^&]*/g, '');
        try {
          const info = await ytdl.getInfo(videoUrl);
          tracks.push({
            title: info.videoDetails.title,
            url: info.videoDetails.video_url,
            duration: formatDuration(Number(info.videoDetails.lengthSeconds)),
            requestedBy: null,
          });
        } catch (vErr) {
          console.error('[MusicPlayer] Video fallback also failed:', vErr.message);
          return { tracks: [], error: `Playlist and video lookup both failed: ${plErr.message}` };
        }
      }
    } else if (isYouTube || (isUrl && ytdl.validateURL(query))) {
      // Single YouTube video
      const info = await ytdl.getInfo(query);
      tracks.push({
        title: info.videoDetails.title,
        url: info.videoDetails.video_url,
        duration: formatDuration(Number(info.videoDetails.lengthSeconds)),
        requestedBy: null,
      });
    } else if (isSoundCloud && playDl) {
      const validated = await playDl.validate(query);
      if (validated === 'so_track') {
        const info = await playDl.soundcloud(query);
        tracks.push({ title: info.name, url: info.url, duration: formatDuration(Math.floor(info.durationInMs / 1000)), requestedBy: null });
      } else if (validated === 'so_playlist') {
        const pl = await playDl.soundcloud(query);
        for (const t of (pl.tracks || []).slice(0, 100)) {
          tracks.push({ title: t.name, url: t.url, duration: formatDuration(Math.floor(t.durationInMs / 1000)), requestedBy: null });
        }
      }
    } else if (isSpotify && playDl) {
      // Spotify -> resolve metadata then search YouTube
      const validated = await playDl.validate(query);
      if (validated === 'sp_track') {
        const sp = await playDl.spotify(query);
        const searched = await YouTube.search(`${sp.name} ${sp.artists?.map(a => a.name).join(' ') || ''}`, { limit: 1, type: 'video' });
        if (searched.length > 0) {
          tracks.push({ title: sp.name, url: `https://www.youtube.com/watch?v=${searched[0].id}`, duration: formatDuration(Math.floor((sp.durationInMs || 0) / 1000)), requestedBy: null });
        }
      } else {
        const sp = await playDl.spotify(query);
        const items = await sp.all_tracks();
        for (const t of items.slice(0, 50)) {
          try {
            const searched = await YouTube.search(`${t.name} ${t.artists?.map(a => a.name).join(' ') || ''}`, { limit: 1, type: 'video' });
            if (searched.length > 0) {
              tracks.push({ title: t.name, url: `https://www.youtube.com/watch?v=${searched[0].id}`, duration: formatDuration(Math.floor((t.durationInMs || 0) / 1000)), requestedBy: null });
            }
          } catch { /* skip failed lookups */ }
        }
      }
    } else {
      // Text search on YouTube
      const results = await YouTube.search(query, { limit: 1, type: 'video' });
      if (results.length > 0) {
        tracks.push({
          title: results[0].title || 'Unknown',
          url: `https://www.youtube.com/watch?v=${results[0].id}`,
          duration: formatDuration(results[0].duration / 1000),
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
async function createStreamResource(track) {
  const url = typeof track === 'string' ? track : track.url;
  const isSoundCloud = /soundcloud\.com/i.test(url);

  if (isSoundCloud && playDl) {
    const stream = await playDl.stream(url);
    return createAudioResource(stream.stream, { inputType: stream.type });
  }

  // YouTube — use @distube/ytdl-core
  const stream = ytdl(url, {
    filter: 'audioonly',
    quality: 'highestaudio',
    highWaterMark: 1 << 25,
  });
  return createAudioResource(stream, { inputType: StreamType.Arbitrary });
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
    const resource = await createStreamResource(track);
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
  if (!state) return;
  // If player is already Idle, stop() is a no-op — call playNext directly
  if (state.player.state.status === AudioPlayerStatus.Idle) {
    playNext(guildId, client);
  } else {
    state.player.stop(); // triggers Idle → playNext
  }
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
  createGuildPlayer,
  pause,
  resume,
  skip,
  setLoop,
  clearQueue,
  removeFromQueue,
  playNext,
  guildPlayers,
};
