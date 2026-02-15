const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const db = require('../utils/db');

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
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // ==================== SITE TRACKING (public, fire-and-forget) ====================
  app.post('/api/track', async (req, res) => {
    try {
      const { event } = req.body;
      const allowed = ['site_visitors', 'discord_clicks', 'manager_clicks'];
      if (!event || !allowed.includes(event)) {
        return res.status(400).json({ error: 'Invalid event. Allowed: ' + allowed.join(', ') });
      }
      await db.incrementSiteAnalytic(event);
      res.json({ success: true });
    } catch (e) {
      console.error('[API] Track error:', e.message);
      res.status(500).json({ error: 'Tracking failed' });
    }
  });

  // ==================== GLOBAL STATS (public, for website ticker) ====================
  app.get('/api/stats', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    try {
      const stats = await db.getGlobalStats();

      // Fetch live wallet balances (treasury + user wallets)
      let treasuryWalletValue = 0;
      let userWalletValue = 0;
      try {
        const crypto = require('../utils/crypto');
        const solPrice = await crypto.getSolanaPrice() || 0;

        // Get all guild treasury wallets
        const guildWallets = await new Promise((resolve, reject) => {
          db.db.all(`SELECT DISTINCT wallet_address FROM guild_wallets`, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        });
        const treasuryBalances = await Promise.allSettled(
          guildWallets.map(w => crypto.getBalance(w.wallet_address))
        );
        const treasurySolTotal = treasuryBalances.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
        treasuryWalletValue = treasurySolTotal * solPrice;

        // Get all user wallets
        const userWallets = await new Promise((resolve, reject) => {
          db.db.all(`SELECT DISTINCT solana_address FROM users WHERE solana_address IS NOT NULL`, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        });
        const userBalances = await Promise.allSettled(
          userWallets.map(u => crypto.getBalance(u.solana_address))
        );
        const userSolTotal = userBalances.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
        userWalletValue = userSolTotal * solPrice;
      } catch (walletErr) {
        console.error('[API] Stats wallet balance error:', walletErr.message);
      }

      res.json({
        ...stats,
        treasuryWalletValue,
        userWalletValue,
        totalWalletValue: treasuryWalletValue + userWalletValue
      });
    } catch (e) {
      console.error('[API] Stats error:', e.message);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
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

      const endTimestamp = event.ends_at ? Math.floor(new Date(event.ends_at).getTime() / 1000) : null;

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

  // Start listening
  
app.listen(port, () => {
    console.log(`[API] Server listening on port ${port}`);
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
return app;
};
