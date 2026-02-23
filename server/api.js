const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const db = require('../utils/db');
const { syncWalletToBackend } = require('../utils/walletSync');

module.exports = (client) => {
  const app = express();
  const port = process.env.PORT || 3000;

  app.use(express.json());
  app.use(cookieParser());

  const isProd = process.env.NODE_ENV === 'production';
  const uiBase = process.env.DCB_UI_BASE || null;
  const publicBase = process.env.DCB_PUBLIC_URL || null;
  const cookieSameSite = (process.env.DCB_COOKIE_SAMESITE || (isProd ? 'none' : 'lax'));
  const cookieSecure = isProd;

  // CORS - allow frontend origin and allow credentials
  const allowedOrigins = (() => {
    const origins = [];
    if (uiBase) {
      try { origins.push(new URL(uiBase).origin); } catch (_) { origins.push(uiBase); }
    }
    origins.push('https://illmedicine.github.io');
    return origins;
  })();

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, origin);
      if (allowedOrigins.includes(origin)) return cb(null, origin);
      return cb(null, false);
    },
    credentials: true,
  }));

  // Basic health check
  const BOT_BUILD_TS = new Date().toISOString();
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      build: BOT_BUILD_TS,
      gateway: client?.ws?.status === 0 ? 'connected' : `status_${client?.ws?.status}`,
      user: client?.user?.tag || null,
      guilds: client?.guilds?.cache?.size || 0,
      commands: client?.commands?.size || 0,
      uptime: client?.uptime || 0
    });
  });

  // Check which auth providers are configured
  app.get('/api/auth/providers', (req, res) => {
    res.json({
      discord: !!process.env.DISCORD_CLIENT_ID,
      google: !!process.env.GOOGLE_CLIENT_ID,
    });
  });

  // Helper to compute base url for redirect URIs
  function baseUrl(req) {
    if (publicBase) return publicBase.replace(/\/$/, '');
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    return `${proto}://${req.get('host')}`;
  }

  const SESSION_SECRET = process.env.DCB_SESSION_SECRET || 'change-this-secret';
  const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

  function getSessionUser(req) {
    const token = req.cookies?.dcb_session;
    if (!token) return null;
    try {
      return jwt.verify(token, SESSION_SECRET);
    } catch (_) {
      return null;
    }
  }

  function requireAuth(req, res, next) {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    return next();
  }

  async function requireGuildOwner(req, res, next) {
    try {
      const guildId = req.params.guildId || req.body.guild_id || req.query.guild_id;
      if (!guildId) return res.status(400).json({ error: 'missing_guild_id' });
      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
      const ownerId = guild?.ownerId;
      if (!ownerId) return res.status(403).json({ error: 'cannot_determine_owner' });
      if (!req.user || req.user.id !== ownerId) return res.status(403).json({ error: 'forbidden_not_guild_owner' });
      req.guild = guild;
      return next();
    } catch (err) {
      return res.status(404).json({ error: 'guild_not_found' });
    }
  }

  async function fetchTextChannel(guildId, channelId) {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !('guildId' in channel) || channel.guildId !== guildId) {
      throw new Error('invalid_channel');
    }
    if (!('send' in channel)) {
      throw new Error('not_text_channel');
    }
    return channel;
  }

  function safeIso(dt) {
    if (!dt) return null;
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  // Start Discord OAuth - redirect to Discord authorize URL
  app.get('/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId) return res.status(500).send('DISCORD_CLIENT_ID not configured');

    const state = crypto.randomBytes(12).toString('hex');
    res.cookie('dcb_oauth_state', state, { httpOnly: true, sameSite: cookieSameSite, secure: cookieSecure });

    const redirectUri = encodeURIComponent(`${baseUrl(req)}/auth/discord/callback`);
    const scope = encodeURIComponent('identify email guilds');

    const url = `https://discord.com/api/oauth2/authorize?response_type=code&client_id=${clientId}&scope=${scope}&redirect_uri=${redirectUri}&prompt=consent&state=${state}`;
    return res.redirect(url);
  });

  // Callback - exchange code for token, create session cookie and redirect back to UI
  app.get('/auth/discord/callback', async (req, res) => {
    const { code, state } = req.query;
    const savedState = req.cookies?.dcb_oauth_state;

    if (!code) return res.status(400).send('Missing code');
    if (!state || !savedState || state !== savedState) return res.status(400).send('Invalid OAuth state');

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.status(500).send('OAuth not configured on server');

    try {
      const tokenResp = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${baseUrl(req)}/auth/discord/callback`
      }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const accessToken = tokenResp.data.access_token;

      // Fetch user info
      const userResp = await axios.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      // Create a session JWT
      const payload = {
        id: userResp.data.id,
        username: userResp.data.username,
        discriminator: userResp.data.discriminator,
        avatar: userResp.data.avatar
      };

      const token = jwt.sign(payload, SESSION_SECRET, { expiresIn: SESSION_TTL_SECONDS });

      // Set cookie
      res.cookie('dcb_session', token, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
        maxAge: SESSION_TTL_SECONDS * 1000
      });

      res.clearCookie('dcb_oauth_state');

      // Redirect back to UI (if configured) or show success page
      if (uiBase) {
        // if frontend is separate, redirect to its root
        return res.redirect(uiBase);
      }

      return res.send(`
        <html>
          <head><title>DCB Login Success</title></head>
          <body>
            <h1>Login successful</h1>
            <p>Welcome, ${userResp.data.username}#${userResp.data.discriminator}</p>
            <p>You can close this window and return to the admin UI.</p>
          </body>
        </html>
      `);
    } catch (err) {
      console.error('[OAuth] Error exchanging code or fetching user:', err.response ? err.response.data : err.message);
      return res.status(500).send('OAuth exchange failed');
    }
  });

  // Logout
  app.post('/auth/logout', (req, res) => {
    res.clearCookie('dcb_session');
    res.json({ ok: true });
  });

  // Return current session user
  app.get('/api/auth/me', (req, res) => {
    const token = req.cookies?.dcb_session;
    if (!token) return res.status(401).json({ error: 'no_session' });
    try {
      const payload = jwt.verify(token, SESSION_SECRET);
      return res.json({ user: payload });
    } catch (e) {
      return res.status(401).json({ error: 'invalid_session' });
    }
  });

  // ==================== Admin API (requires Discord OAuth session + guild ownership) ====================

  // List guilds where the logged-in user is owner and the bot is present
  app.get('/api/admin/guilds', requireAuth, async (req, res) => {
    try {
      // Use Discord OAuth "guilds" scope via API call (more accurate than cache)
      const authHeader = req.headers.authorization;
      // We don't store user access token; so we instead infer by checking ownerId on guilds bot is in.
      const results = [];
      for (const g of client.guilds.cache.values()) {
        try {
          const guild = await g.fetch();
          if (guild.ownerId === req.user.id) {
            results.push({ id: guild.id, name: guild.name });
          }
        } catch (_) {
          // ignore
        }
      }
      return res.json(results);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_list_guilds' });
    }
  });

  // List channels in a guild (text + announcement) for publish dropdowns
  app.get('/api/admin/guilds/:guildId/channels', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const guild = req.guild;
      const channels = await guild.channels.fetch();
      const out = [];
      for (const c of channels.values()) {
        // 0 = GuildText, 5 = GuildAnnouncement
        if (c && (c.type === 0 || c.type === 5)) {
          out.push({ id: c.id, name: c.name, type: c.type });
        }
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      return res.json(out);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_list_channels' });
    }
  });

  // ---- Vote Events ----
  app.get('/api/admin/guilds/:guildId/vote-events', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const rows = await db.getActiveVoteEvents(req.guild.id);
      return res.json(rows || []);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_list_vote_events' });
    }
  });

  app.post('/api/admin/guilds/:guildId/vote-events', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const {
        channel_id,
        title,
        description,
        prize_amount,
        currency,
        min_participants,
        max_participants,
        duration_minutes,
        owner_favorite_image_id,
        images
      } = req.body || {};

      if (!channel_id || !title || !description) return res.status(400).json({ error: 'missing_fields' });
      if (!min_participants || !max_participants) return res.status(400).json({ error: 'missing_participant_limits' });
      if (!Array.isArray(images) || images.length < 2) return res.status(400).json({ error: 'at_least_two_images_required' });

      const eventId = await db.createVoteEvent(
        req.guild.id,
        channel_id,
        title,
        description,
        Number(prize_amount || 0),
        currency || 'USD',
        Number(min_participants),
        Number(max_participants),
        duration_minutes == null ? null : Number(duration_minutes),
        owner_favorite_image_id || null,
        req.user.id
      );

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (!img || !img.id || !img.url) continue;
        await db.addVoteEventImage(eventId, String(img.id), String(img.url), i + 1);
      }

      const created = await db.getVoteEvent(eventId);
      return res.json({ id: eventId, event: created });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_create_vote_event' });
    }
  });

  app.post('/api/admin/guilds/:guildId/vote-events/:eventId/publish', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId);
      const event = await db.getVoteEvent(eventId);
      if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'vote_event_not_found' });

      const channelId = req.body?.channel_id || event.channel_id;
      const channel = await fetchTextChannel(req.guild.id, channelId);
      const images = await db.getVoteEventImages(eventId);

      // Recalculate ends_at from NOW so the timer starts at publish time, not creation time
      let endTimestamp = null;
      if (event.duration_minutes) {
        const newEndsAt = new Date(Date.now() + event.duration_minutes * 60 * 1000).toISOString();
        await db.updateVoteEventEndsAt(eventId, newEndsAt);
        event.ends_at = newEndsAt;
        endTimestamp = Math.floor(new Date(newEndsAt).getTime() / 1000);
      } else if (event.ends_at) {
        endTimestamp = Math.floor(new Date(event.ends_at).getTime() / 1000);
      }

      const embed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle(`ðŸ—³ï¸ ${event.title}`)
        .setDescription(event.description || '')
        .addFields(
          { name: 'ðŸ‘¥ Participants', value: `${event.current_participants}/${event.max_participants}`, inline: true },
          { name: 'âœ… Min to Start', value: `${event.min_participants}`, inline: true },
          { name: 'ðŸŽ Prize', value: `${Number(event.prize_amount || 0)} ${event.currency}`, inline: true }
        )
        .setFooter({ text: `Event #${eventId}` })
        .setTimestamp();

      if (endTimestamp) {
        embed.addFields({ name: 'â±ï¸ Ends', value: `<t:${endTimestamp}:R>`, inline: true });
      }
      if (images && images[0]?.image_url) {
        embed.setImage(images[0].image_url);
      }

      const joinButton = new ButtonBuilder()
        .setCustomId(`vote_event_join_${eventId}`)
        .setLabel('ðŸŽ« Join Event')
        .setStyle(ButtonStyle.Success);

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`vote_event_vote_${eventId}`)
        .setPlaceholder('Select your favorite image to vote')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          (images || []).map(img => new StringSelectMenuOptionBuilder()
            .setLabel(`Image ${img.upload_order}`)
            .setValue(img.image_id)
            .setDescription(`Vote for Image ${img.upload_order}`)
          )
        );

      const msg = await channel.send({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(joinButton),
          new ActionRowBuilder().addComponents(selectMenu)
        ]
      });

      await db.updateVoteEventMessageId(eventId, msg.id);
      if (channelId !== event.channel_id) {
        // Keep DB channel_id aligned with where it was published
        await new Promise((resolve, reject) => {
          db.db.run(
            `UPDATE vote_events SET channel_id = ? WHERE id = ?`,
            [channelId, eventId],
            (err) => err ? reject(err) : resolve()
          );
        });
      }

      return res.json({ ok: true, message_id: msg.id, channel_id: channelId });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_publish_vote_event' });
    }
  });

  // ---- Contests ----
  app.get('/api/admin/guilds/:guildId/contests', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const all = await db.getAllContests();
      const filtered = (all || []).filter(c => c.guild_id === req.guild.id);
      return res.json(filtered);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_list_contests' });
    }
  });

  app.post('/api/admin/guilds/:guildId/contests', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const {
        channel_id,
        title,
        description,
        prize_amount,
        currency,
        num_winners,
        max_entries,
        duration_hours,
        reference_url
      } = req.body || {};

      if (!channel_id || !title || !prize_amount || !max_entries || !duration_hours || !reference_url) {
        return res.status(400).json({ error: 'missing_fields' });
      }

      const contestId = await db.createContest(
        req.guild.id,
        channel_id,
        title,
        description || '',
        Number(prize_amount),
        currency || 'USD',
        Number(num_winners || 1),
        Number(max_entries),
        Number(duration_hours),
        String(reference_url),
        req.user.id
      );

      const created = await db.getContest(contestId);
      return res.json({ id: contestId, contest: created });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_create_contest' });
    }
  });

  app.post('/api/admin/guilds/:guildId/contests/:contestId/publish', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const contestId = Number(req.params.contestId);
      const contest = await db.getContest(contestId);
      if (!contest || contest.guild_id !== req.guild.id) return res.status(404).json({ error: 'contest_not_found' });

      const channelId = req.body?.channel_id || contest.channel_id;
      const channel = await fetchTextChannel(req.guild.id, channelId);
      const endTimestamp = contest.ends_at ? Math.floor(new Date(contest.ends_at).getTime() / 1000) : null;

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(`ðŸ† ${contest.title}`)
        .setDescription(contest.description || '')
        .addFields(
          { name: 'ðŸŽ Prize', value: `${contest.prize_amount} ${contest.currency}`, inline: true },
          { name: 'ðŸ‘‘ Winners', value: `${contest.num_winners}`, inline: true },
          { name: 'ðŸŽŸï¸ Entries', value: `${contest.current_entries}/${contest.max_entries}`, inline: true },
          { name: 'ðŸ”— Reference', value: contest.reference_url }
        )
        .setFooter({ text: `Contest #${contestId}` })
        .setTimestamp();

      if (endTimestamp) {
        embed.addFields({ name: 'â±ï¸ Ends', value: `<t:${endTimestamp}:R>`, inline: true });
      }

      const enterButton = new ButtonBuilder()
        .setCustomId(`contest_enter_${contestId}`)
        .setLabel('ðŸŽ« Enter Contest')
        .setStyle(ButtonStyle.Primary);

      const infoButton = new ButtonBuilder()
        .setCustomId(`contest_info_${contestId}`)
        .setLabel('â„¹ï¸ Info')
        .setStyle(ButtonStyle.Secondary);

      const msg = await channel.send({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(enterButton, infoButton)]
      });

      await db.updateContestMessageId(contestId, msg.id);

      if (channelId !== contest.channel_id) {
        await new Promise((resolve, reject) => {
          db.db.run(
            `UPDATE contests SET channel_id = ? WHERE id = ?`,
            [channelId, contestId],
            (err) => err ? reject(err) : resolve()
          );
        });
      }

      return res.json({ ok: true, message_id: msg.id, channel_id: channelId });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_publish_contest' });
    }
  });

  // ---- Bulk Tasks ----
  app.get('/api/admin/guilds/:guildId/bulk-tasks', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const rows = await db.getAllBulkTasks(req.guild.id);
      return res.json(rows || []);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_list_bulk_tasks' });
    }
  });

  app.post('/api/admin/guilds/:guildId/bulk-tasks', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { title, description, payout_amount, payout_currency, total_slots } = req.body || {};
      if (!title || payout_amount == null || !payout_currency || !total_slots) {
        return res.status(400).json({ error: 'missing_fields' });
      }
      const taskId = await db.createBulkTask(
        req.guild.id,
        title,
        description || '',
        Number(payout_amount),
        payout_currency,
        Number(total_slots),
        req.user.id
      );
      const created = await db.getBulkTask(taskId);
      return res.json({ id: taskId, task: created });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_create_bulk_task' });
    }
  });

  app.post('/api/admin/guilds/:guildId/bulk-tasks/:taskId/publish', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const taskId = Number(req.params.taskId);
      const task = await db.getBulkTask(taskId);
      if (!task || task.guild_id !== req.guild.id) return res.status(404).json({ error: 'bulk_task_not_found' });

      const channelId = req.body?.channel_id;
      if (!channelId) return res.status(400).json({ error: 'missing_channel_id' });
      const channel = await fetchTextChannel(req.guild.id, channelId);

      const availableSlots = Number(task.total_slots) - Number(task.filled_slots);

      const embed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle(`ðŸ“Œ Task: ${task.title}`)
        .setDescription(task.description || '')
        .addFields(
          { name: 'ðŸ’° Payout', value: `${task.payout_amount} ${task.payout_currency}`, inline: true },
          { name: 'ðŸŽŸï¸ Slots', value: `${availableSlots}/${task.total_slots}`, inline: true },
          { name: 'ðŸ†” Task ID', value: `#${taskId}`, inline: true }
        )
        .setTimestamp();

      const claimButton = new ButtonBuilder()
        .setCustomId(`bulk_task_claim_${taskId}`)
        .setLabel('ðŸŽ¯ Claim Slot')
        .setStyle(ButtonStyle.Success);

      const msg = await channel.send({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(claimButton)]
      });

      return res.json({ ok: true, message_id: msg.id, channel_id: channelId });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_publish_bulk_task' });
    }
  });

  // ---- Dashboard Stats ----
  app.get('/api/admin/guilds/:guildId/dashboard/stats', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const stats = await db.getDashboardStats(req.guild.id);
      return res.json(stats);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_get_stats' });
    }
  });

  app.get('/api/admin/guilds/:guildId/dashboard/activity', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 20;
      const type = req.query.type || null;
      const rows = await db.getActivityFeed(req.guild.id, limit, type);
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_get_activity' });
    }
  });

  // ---- Completed Contests (contests + vote events + bulk tasks) ----
  app.get('/api/admin/guilds/:guildId/dashboard/completed-contests', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 20;
      const rows = await db.getCompletedContestsAll(req.guild.id, limit);
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_get_completed_contests' });
    }
  });

  app.get('/api/admin/guilds/:guildId/dashboard/balance', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const wallet = await db.getGuildWallet(req.guild.id);
      // Return wallet info; actual balance fetched client-side or via Solana RPC
      return res.json({ wallet_address: wallet?.wallet_address || null, wallet });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_get_balance' });
    }
  });

  // ---- Guild Treasury Wallet Management ----
  app.get('/api/admin/guilds/:guildId/wallet', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const wallet = await db.getGuildWallet(req.guild.id);
      return res.json(wallet || null);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_get_wallet' });
    }
  });

  app.post('/api/admin/guilds/:guildId/wallet', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { wallet_address, label, network } = req.body || {};
      if (!wallet_address || typeof wallet_address !== 'string' || wallet_address.length < 32 || wallet_address.length > 44) {
        return res.status(400).json({ error: 'invalid_wallet_address' });
      }
      await db.setGuildWallet(req.guild.id, wallet_address.trim(), req.user.id, label || 'Treasury', network || 'mainnet-beta');
      await db.logActivity(req.guild.id, 'wallet', 'Treasury Wallet Connected', `Wallet ${wallet_address.slice(0,8)}...${wallet_address.slice(-4)} connected`, `@${req.user.username}`, 0, 'SOL', null);
      // Sync to backend (DCB Event Manager)
      syncWalletToBackend({
        guildId: req.guild.id,
        action: 'connect',
        wallet_address: wallet_address.trim(),
        label: label || 'Treasury',
        network: network || 'mainnet-beta',
        configured_by: req.user.id
      });
      const wallet = await db.getGuildWallet(req.guild.id);
      return res.json(wallet);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_set_wallet' });
    }
  });

  app.patch('/api/admin/guilds/:guildId/wallet', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const updates = req.body || {};
      if (updates.wallet_address && (typeof updates.wallet_address !== 'string' || updates.wallet_address.length < 32 || updates.wallet_address.length > 44)) {
        return res.status(400).json({ error: 'invalid_wallet_address' });
      }
      await db.updateGuildWallet(req.guild.id, updates);
      const wallet = await db.getGuildWallet(req.guild.id);
      return res.json(wallet);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_update_wallet' });
    }
  });

  app.delete('/api/admin/guilds/:guildId/wallet', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      await db.deleteGuildWallet(req.guild.id);
      await db.logActivity(req.guild.id, 'wallet', 'Treasury Wallet Disconnected', 'Treasury wallet removed', `@${req.user.username}`, 0, 'SOL', null);
      // Sync disconnect to backend
      syncWalletToBackend({ guildId: req.guild.id, action: 'disconnect' });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_delete_wallet' });
    }
  });

  app.post('/api/admin/guilds/:guildId/wallet/budget', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { budget_total, budget_currency } = req.body || {};
      if (budget_total == null || Number(budget_total) < 0) return res.status(400).json({ error: 'invalid_budget' });
      await db.updateGuildWallet(req.guild.id, { budget_total: Number(budget_total), budget_currency: budget_currency || 'SOL' });
      const wallet = await db.getGuildWallet(req.guild.id);
      return res.json(wallet);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_set_budget' });
    }
  });

  app.post('/api/admin/guilds/:guildId/wallet/budget/reset', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      await db.updateGuildWallet(req.guild.id, { budget_spent: 0 });
      const wallet = await db.getGuildWallet(req.guild.id);
      return res.json(wallet);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_reset_budget' });
    }
  });

  // ---- Transaction History ----
  app.get('/api/admin/guilds/:guildId/transactions', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const rows = await db.getRecentTransactions(req.guild.id, limit);
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_get_transactions' });
    }
  });

  // ---- Events (Scheduled Events) ----
  app.get('/api/admin/guilds/:guildId/events', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const rows = await db.getEventsForGuild(req.guild.id);
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_list_events' });
    }
  });

  app.post('/api/admin/guilds/:guildId/events', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { channel_id, title, description, event_type, prize_amount, currency, max_participants, starts_at, ends_at } = req.body || {};
      if (!title) return res.status(400).json({ error: 'missing_title' });
      const eventId = await db.createEvent(
        req.guild.id,
        channel_id || null,
        String(title),
        description || '',
        event_type || 'general',
        Number(prize_amount || 0),
        currency || 'SOL',
        max_participants ? Number(max_participants) : null,
        starts_at || null,
        ends_at || null,
        req.user.id
      );
      // Log activity
      await db.logActivity(req.guild.id, 'event', 'Event Scheduled', title, `@${req.user.username}`, Number(prize_amount || 0), currency || 'SOL', eventId);
      const created = await db.getEvent(eventId);
      return res.json(created);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_create_event' });
    }
  });

  app.patch('/api/admin/guilds/:guildId/events/:eventId/status', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId);
      const { status } = req.body || {};
      if (!status) return res.status(400).json({ error: 'missing_status' });
      await db.updateEventStatus(eventId, status);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_update_event' });
    }
  });

  app.delete('/api/admin/guilds/:guildId/events/:eventId', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId);
      await db.deleteEvent(eventId);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_delete_event' });
    }
  });

  // ---- Workers / DCB Roles ----

  // List all workers with aggregated stats
  app.get('/api/admin/guilds/:guildId/workers', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const days = Number(req.query.days) || 30;
      const workers = await db.getGuildWorkersSummary(req.guild.id, days);

      // Enrich with Discord presence if available
      const enriched = await Promise.all(workers.map(async (w) => {
        try {
          const member = await req.guild.members.fetch(w.discord_id);
          return {
            ...w,
            avatar: member.user.displayAvatarURL({ size: 64 }),
            display_name: member.displayName,
            status: member.presence?.status || 'offline',
            joined_guild_at: member.joinedAt?.toISOString() || null,
            account_created_at: member.user.createdAt?.toISOString() || null,
          };
        } catch (_) {
          return { ...w, avatar: null, display_name: w.username, status: 'offline', joined_guild_at: null, account_created_at: null };
        }
      }));

      return res.json(enriched);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_get_workers' });
    }
  });

  // Add a worker
  app.post('/api/admin/guilds/:guildId/workers', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { discord_id, role } = req.body || {};
      if (!discord_id) return res.status(400).json({ error: 'missing_discord_id' });
      const validRoles = ['staff', 'admin'];
      const workerRole = validRoles.includes(role) ? role : 'staff';

      // Fetch username from Discord
      let username = 'unknown';
      try {
        const member = await req.guild.members.fetch(discord_id);
        username = member.user.username;
      } catch (_) {}

      await db.addWorker(req.guild.id, discord_id, username, workerRole, req.user.id);
      await db.logWorkerActivity(req.guild.id, discord_id, 'role_assigned', `Assigned ${workerRole} via dashboard by ${req.user.username}`, null, null, null);
      return res.json({ ok: true, role: workerRole, username });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_add_worker' });
    }
  });

  // Update worker role
  app.patch('/api/admin/guilds/:guildId/workers/:discordId', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { role } = req.body || {};
      if (!['staff', 'admin'].includes(role)) return res.status(400).json({ error: 'invalid_role' });
      await db.updateWorkerRole(req.guild.id, req.params.discordId, role);
      await db.logWorkerActivity(req.guild.id, req.params.discordId, 'role_changed', `Role changed to ${role} via dashboard`, null, null, null);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_update_worker' });
    }
  });

  // Remove worker
  app.delete('/api/admin/guilds/:guildId/workers/:discordId', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      await db.removeWorker(req.guild.id, req.params.discordId);
      await db.logWorkerActivity(req.guild.id, req.params.discordId, 'role_removed', 'Removed via dashboard', null, null, null);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_remove_worker' });
    }
  });

  // Get individual worker detail + activity feed
  app.get('/api/admin/guilds/:guildId/workers/:discordId', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const worker = await db.getWorker(req.guild.id, req.params.discordId);
      if (!worker) return res.status(404).json({ error: 'worker_not_found' });
      const stats = await db.getWorkerStats(req.guild.id, req.params.discordId, 30);
      const activity = await db.getWorkerActivity(req.guild.id, req.params.discordId, 50);

      // Enrich with Discord data
      let enriched = { ...worker, ...stats, activity };
      try {
        const member = await req.guild.members.fetch(req.params.discordId);
        enriched.avatar = member.user.displayAvatarURL({ size: 128 });
        enriched.display_name = member.displayName;
        enriched.status = member.presence?.status || 'offline';
        enriched.joined_guild_at = member.joinedAt?.toISOString() || null;
        enriched.account_created_at = member.user.createdAt?.toISOString() || null;
      } catch (_) {}

      return res.json(enriched);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_get_worker' });
    }
  });

  // Guild-wide worker activity feed
  app.get('/api/admin/guilds/:guildId/workers-activity', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const activity = await db.getGuildWorkerActivity(req.guild.id, limit);
      return res.json(activity);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_get_activity' });
    }
  });

  // ---- Worker Wallet Lookup (uses bot's own users table) ----
  app.get('/api/admin/guilds/:guildId/workers/:discordId/wallet', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const user = await db.getUser(req.params.discordId);
      if (user?.solana_address) {
        return res.json({ wallet_address: user.solana_address, connected: true });
      }
      return res.json({ wallet_address: null, connected: false });
    } catch (err) {
      console.error('[worker-wallet] error:', err?.message || err);
      res.status(500).json({ error: 'failed_to_get_wallet' });
    }
  });

  // ---- Pay Worker (from guild treasury, using bot's DB) ----
  app.post('/api/admin/guilds/:guildId/workers/:discordId/pay', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { amount_usd, memo } = req.body || {};
      const amountUsd = Number(amount_usd);
      if (!amountUsd || amountUsd <= 0 || amountUsd > 100000) {
        return res.status(400).json({ error: 'invalid_amount', message: 'Amount must be between $0.01 and $100,000 USD.' });
      }

      // 1. Verify worker exists
      const worker = await db.getWorker(req.guild.id, req.params.discordId);
      if (!worker) return res.status(404).json({ error: 'worker_not_found' });

      // 2. Get worker's connected wallet address from bot's users table
      const user = await db.getUser(req.params.discordId);
      const recipientAddress = user?.solana_address || null;
      if (!recipientAddress) {
        return res.status(400).json({ error: 'no_wallet', message: 'This worker has not connected a DisCryptoBank user-wallet. They must run /user-wallet connect first.' });
      }

      // 3. Get guild treasury wallet
      const guildWallet = await db.getGuildWallet(req.guild.id);
      if (!guildWallet?.wallet_address) {
        return res.status(400).json({ error: 'no_treasury', message: 'No treasury wallet configured. Set one up in the Treasury tab.' });
      }
      if (!guildWallet.wallet_secret) {
        return res.status(400).json({ error: 'no_secret', message: 'Treasury wallet private key not configured. Add it in the Treasury tab to enable payouts.' });
      }

      // 4. Fetch SOL price
      const crypto = require('../utils/crypto');
      let solPrice;
      try {
        const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
        const priceData = await priceRes.json();
        solPrice = priceData?.solana?.usd;
      } catch (_) {}
      if (!solPrice) {
        return res.status(502).json({ error: 'price_unavailable', message: 'Unable to fetch SOL price. Try again.' });
      }

      // 5. Convert USD to SOL
      const amountSol = amountUsd / solPrice;

      // 6. Send SOL
      const keypair = crypto.getKeypairFromSecret(guildWallet.wallet_secret);
      if (!keypair) {
        return res.status(400).json({ error: 'invalid_key', message: 'Treasury private key is invalid.' });
      }
      const txResult = await crypto.sendSolFrom(keypair, recipientAddress, amountSol);
      if (!txResult?.success) {
        return res.status(500).json({ error: 'tx_failed', message: txResult?.error || 'Transaction failed.' });
      }

      // 7. Log payout
      const signature = txResult.signature;
      await db.logActivity(req.guild.id, 'payroll', 'Staff Paid', `Paid ${worker.username || req.params.discordId} $${amountUsd.toFixed(2)} (◎${amountSol.toFixed(4)})${memo ? ': ' + memo : ''}`, `@${req.user.username}`, amountUsd, 'USD', null);

      await db.recordTransaction(req.guild.id, guildWallet.wallet_address, recipientAddress, amountSol, signature);

      res.json({ ok: true, signature, amount_sol: amountSol, amount_usd: amountUsd, sol_price: solPrice });
    } catch (err) {
      console.error('[payroll] error:', err?.message || err);
      res.status(500).json({ error: 'payment_failed', message: err?.message || 'Payment failed.' });
    }
  });

  // ---- Payroll Summary & History ----
  app.get('/api/admin/guilds/:guildId/payroll/summary', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      // Return empty summary since server/api.js may not have worker_payouts table yet
      res.json({
        today: { count: 0, total_sol: 0, total_usd: 0 },
        week: { count: 0, total_sol: 0, total_usd: 0 },
        month: { count: 0, total_sol: 0, total_usd: 0 },
        allTime: { count: 0, total_sol: 0, total_usd: 0 },
        perWorker: [],
        dailyBreakdown: []
      });
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_payroll' });
    }
  });

  app.get('/api/admin/guilds/:guildId/payroll/history', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      res.json([]);
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_history' });
    }
  });

  // ---- Image proxy for Discord CDN (attachment URLs expire) ----
  app.get('/api/image-proxy', requireAuth, async (req, res) => {
    try {
      const url = req.query.url;
      if (!url || typeof url !== 'string') return res.status(400).json({ error: 'missing_url' });
      const parsed = new URL(url);
      const allowed = ['cdn.discordapp.com', 'media.discordapp.net'];
      if (!allowed.includes(parsed.hostname)) return res.status(403).json({ error: 'domain_not_allowed' });
      const upstream = await axios.get(url, { responseType: 'stream', timeout: 10000 });
      const ct = upstream.headers['content-type'];
      if (ct) res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      upstream.data.pipe(res);
    } catch (err) {
      const status = err?.response?.status || 502;
      res.status(status).json({ error: 'proxy_failed', status });
    }
  });

  // List guild members (for adding workers from dashboard)
  app.get('/api/admin/guilds/:guildId/members', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const members = await req.guild.members.fetch({ limit: 100 });
      const list = members
        .filter(m => !m.user.bot)
        .map(m => ({
          id: m.id,
          username: m.user.username,
          display_name: m.displayName,
          avatar: m.user.displayAvatarURL({ size: 32 }),
        }));
      return res.json(list);
    } catch (err) {
      return res.status(500).json({ error: 'failed_to_list_members' });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  //  PUBLIC STATS — website ticker (no auth required)
  // ══════════════════════════════════════════════════════════════════

  // Promisified wrappers around the raw sqlite3 handle (db.db)
  const rawDb = db.db;
  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    rawDb.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    rawDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    rawDb.run(sql, params, function(err) { err ? reject(err) : resolve(this); });
  });

  /** safe wrapper – returns fallback on DB error so one bad query doesn't sink the whole response */
  async function safe(promise, fallback = null) {
    try { return await promise; } catch (e) { console.warn('[stats] query failed:', e.message); return fallback; }
  }

  app.get('/api/stats', async (_req, res) => {
    try {
      const [
        txRow, contestRow, voteEventRow, eventRow,
        bulkTaskRow, taskRow,
        paidTx,
        prizePoolSOL, prizePoolUSD,
        contestWinners, voteWinners, proofPayouts,
        usersRow, treasuryWalletCount, userWalletCount,
        siteVisitors, totalCommandsRun, managerClicks,
        payWalletCommands
      ] = await Promise.all([
        safe(dbGet('SELECT COUNT(*) AS c FROM transactions'), { c: 0 }),
        safe(dbGet('SELECT COUNT(*) AS c FROM contests'), { c: 0 }),
        safe(dbGet('SELECT COUNT(*) AS c FROM vote_events'), { c: 0 }),
        safe(dbGet('SELECT COUNT(*) AS c FROM events'), { c: 0 }),
        safe(dbGet('SELECT COUNT(*) AS c FROM bulk_tasks'), { c: 0 }),
        safe(dbGet('SELECT COUNT(*) AS c FROM tasks'), { c: 0 }),
        // On-chain transactions (direct SOL transfers)
        safe(dbGet('SELECT COALESCE(SUM(amount), 0) AS total FROM transactions'), { total: 0 }),
        // Total prize pool offered (SOL-denominated events)
        safe(dbGet(`SELECT COALESCE(SUM(prize_amount), 0) AS total FROM (
          SELECT prize_amount FROM vote_events WHERE currency = 'SOL' AND prize_amount > 0
          UNION ALL SELECT prize_amount FROM contests WHERE currency = 'SOL' AND prize_amount > 0
          UNION ALL SELECT prize_amount FROM events WHERE currency = 'SOL' AND prize_amount > 0
          UNION ALL SELECT payout_amount AS prize_amount FROM bulk_tasks WHERE payout_currency = 'SOL' AND payout_amount > 0
        )`), { total: 0 }),
        // Total prize pool offered (USD-denominated events)
        safe(dbGet(`SELECT COALESCE(SUM(prize_amount), 0) AS total FROM (
          SELECT prize_amount FROM vote_events WHERE currency = 'USD' AND prize_amount > 0
          UNION ALL SELECT prize_amount FROM contests WHERE currency = 'USD' AND prize_amount > 0
          UNION ALL SELECT prize_amount FROM events WHERE currency = 'USD' AND prize_amount > 0
          UNION ALL SELECT payout_amount AS prize_amount FROM bulk_tasks WHERE payout_currency = 'USD' AND payout_amount > 0
        )`), { total: 0 }),
        safe(dbGet("SELECT COUNT(*) AS c FROM contest_entries WHERE is_winner = 1"), { c: 0 }),
        safe(dbGet("SELECT COUNT(*) AS c FROM vote_event_participants WHERE is_winner = 1"), { c: 0 }),
        safe(dbGet("SELECT COUNT(*) AS c FROM proof_submissions WHERE status = 'approved'"), { c: 0 }),
        safe(dbGet('SELECT COUNT(*) AS c FROM users'), { c: 0 }),
        // Wallet counts
        safe(dbGet('SELECT COUNT(*) AS c FROM guild_wallets WHERE wallet_address IS NOT NULL'), { c: 0 }),
        safe(dbGet("SELECT COUNT(*) AS c FROM users WHERE solana_address IS NOT NULL"), { c: 0 }),
        safe(dbGet("SELECT count FROM site_analytics WHERE metric = 'site_visitors'"), { count: 0 }),
        safe(dbGet('SELECT COUNT(*) AS c FROM command_audit'), { c: 0 }),
        safe(dbGet("SELECT count FROM site_analytics WHERE metric = 'manager_clicks'"), { count: 0 }),
        safe(dbGet("SELECT COUNT(*) AS c FROM command_audit WHERE command_name IN ('pay', 'wallet', 'user-wallet', 'bot-wallet')"), { c: 0 }),
      ]);

      // Active servers = actual Discord guilds the bot is in (live count)
      const activeServers = client?.guilds?.cache?.size || 0;

      // Prize pool raw values (computed after solPrice is fetched below)
      const txSOL = paidTx.total || 0;
      const poolSOL = prizePoolSOL.total || 0;
      const poolUSD = prizePoolUSD.total || 0;

      // ── Inline Solana helpers (avoids dependency on utils/crypto) ──
      const LAMPORTS_PER_SOL = 1_000_000_000;
      const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const axios = require('axios');

      async function fetchSolBalance(address) {
        try {
          const { data } = await axios.post(SOLANA_RPC, {
            jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address]
          }, { timeout: 8000 });
          return (data?.result?.value || 0) / LAMPORTS_PER_SOL;
        } catch { return 0; }
      }

      async function fetchSolPrice() {
        try {
          const { data } = await axios.get(
            'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
            { timeout: 8000 }
          );
          return data?.solana?.usd || 0;
        } catch { return 0; }
      }

      // Fetch SOL price + wallet balances (best-effort)
      let solPrice = 0;
      let treasuryBalanceSOL = 0;
      let userBalanceSOL = 0;
      try {
        solPrice = await fetchSolPrice();

        // Treasury wallets
        const treasuryWallets = await safe(dbAll('SELECT wallet_address FROM guild_wallets WHERE wallet_address IS NOT NULL'), []);
        const treasuryBalances = await Promise.all(
          treasuryWallets.map(w => fetchSolBalance(w.wallet_address))
        );
        treasuryBalanceSOL = treasuryBalances.reduce((s, b) => s + b, 0);

        // User wallets (bot DB uses solana_address)
        const userWallets = await safe(dbAll("SELECT solana_address AS addr FROM users WHERE solana_address IS NOT NULL"), []);
        const userBalances = await Promise.all(
          userWallets.map(w => fetchSolBalance(w.addr))
        );
        userBalanceSOL = userBalances.reduce((s, b) => s + b, 0);
      } catch (e) {
        console.warn('[stats] wallet/price fetch failed:', e.message);
      }

      const treasuryWalletValue = treasuryBalanceSOL * solPrice;
      const userWalletValue = userBalanceSOL * solPrice;

      // Total prize pool (computed after solPrice is known)
      const totalPaidOutSOL = txSOL + poolSOL + (solPrice > 0 ? poolUSD / solPrice : 0);
      const totalPaidOutUSD = (txSOL + poolSOL) * solPrice + poolUSD;

      res.json({
        totalTransactions: payWalletCommands?.c || 0,
        totalWinners: (contestWinners.c || 0) + (voteWinners.c || 0),
        eventsHosted: (contestRow.c || 0) + (voteEventRow.c || 0) + (eventRow.c || 0),
        tasksCreated: (bulkTaskRow.c || 0) + (taskRow.c || 0),
        totalPaidOut: totalPaidOutUSD,
        totalPaidOutSOL,
        treasuryWalletValue,
        treasuryWalletValueSOL: treasuryBalanceSOL,
        userWalletValue,
        userWalletValueSOL: userBalanceSOL,
        totalWalletValue: treasuryWalletValue + userWalletValue,
        totalWalletValueSOL: treasuryBalanceSOL + userBalanceSOL,
        treasuryWalletsConnected: treasuryWalletCount.c,
        userWalletsConnected: userWalletCount.c,
        activeServers,
        totalPayouts: (contestWinners.c || 0) + (voteWinners.c || 0) + (proofPayouts.c || 0),
        totalUsers: usersRow.c,
        siteVisitors: siteVisitors?.count || 0,
        totalCommandsRun: totalCommandsRun?.c || 0,
        managerClicks: managerClicks?.count || 0,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[stats] error:', err);
      res.status(500).json({ error: 'stats_error' });
    }
  });

  // ── Site analytics tracking (visitors / clicks) ────────────────────
  app.post('/api/track', async (req, res) => {
    try {
      const { metric } = req.body;
      const allowed = ['site_visitors', 'discord_clicks', 'manager_clicks'];
      if (!metric || !allowed.includes(metric)) {
        return res.status(400).json({ error: 'invalid_metric' });
      }
      await dbRun(
        `INSERT INTO site_analytics (metric, count, updated_at)
         VALUES (?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(metric) DO UPDATE SET count = count + 1, updated_at = CURRENT_TIMESTAMP`,
        [metric]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error('[track] error:', err);
      res.status(500).json({ error: 'track_error' });
    }
  });

  // ── Internal API: User wallet lookup (called by backend service) ─────
  app.get('/api/internal/user-wallet/:discordId', async (req, res) => {
    try {
      // Allow if secrets match, or if bot has no secret configured (permissive for wallet address lookups)
      const secret = req.headers['x-dcb-internal-secret'] || '';
      const expected = process.env.DCB_INTERNAL_SECRET || '';
      if (expected && secret !== expected) {
        return res.status(403).json({ error: 'unauthorized' });
      }
      const user = await db.getUser(req.params.discordId);
      if (user?.solana_address) {
        return res.json({ wallet_address: user.solana_address, username: user.username, connected: true });
      }
      res.json({ wallet_address: null, connected: false });
    } catch (err) {
      console.error('[internal/user-wallet] error:', err?.message || err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // Bulk sync: return all user wallets (for backend to cache)
  app.get('/api/internal/user-wallets', async (req, res) => {
    try {
      const secret = req.headers['x-dcb-internal-secret'] || '';
      const expected = process.env.DCB_INTERNAL_SECRET || '';
      if (expected && secret !== expected) {
        return res.status(403).json({ error: 'unauthorized' });
      }
      const rawDb = db.db;
      const rows = await new Promise((resolve, reject) => {
        rawDb.all('SELECT discord_id, solana_address, username FROM users WHERE solana_address IS NOT NULL', [], (err, rows) => {
          if (err) reject(err); else resolve(rows || []);
        });
      });
      res.json(rows);
    } catch (err) {
      console.error('[internal/user-wallets] error:', err?.message || err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // ── START HTTP SERVER ──────────────────────────────────────────────
  app.listen(port, () => {
    console.log(`[API] Server listening on port ${port}`);
  });

  return app;
};
