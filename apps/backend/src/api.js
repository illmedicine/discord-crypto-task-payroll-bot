const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const jwt = require('jsonwebtoken')
const axios = require('axios')
const crypto = require('crypto')
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js')
const db = require('./db')

module.exports = function buildApi({ discordClient }) {
  const app = express()

  app.use(express.json())
  app.use(cookieParser())

  const isProd = process.env.NODE_ENV === 'production'
  const uiBase = process.env.DCB_UI_BASE || null
  const publicBase = process.env.DCB_PUBLIC_URL || null
  const cookieSameSite = process.env.DCB_COOKIE_SAMESITE || (isProd ? 'none' : 'lax')
  const cookieSecure = isProd

  const allowedOrigin = (() => {
    if (!uiBase) return '*'
    try {
      return new URL(uiBase).origin
    } catch (_) {
      return uiBase
    }
  })()

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)
      if (allowedOrigin === '*') return cb(null, true)
      return cb(null, origin === allowedOrigin)
    },
    credentials: true,
  }))

  function baseUrl(req) {
    if (publicBase) return publicBase.replace(/\/$/, '')
    const proto = req.headers['x-forwarded-proto'] || req.protocol
    return `${proto}://${req.get('host')}`
  }

  const sessionSecret = process.env.DCB_SESSION_SECRET

  function getBearerToken(req) {
    const h = req.headers?.authorization
    if (!h || typeof h !== 'string') return null
    const m = h.match(/^Bearer\s+(.+)$/i)
    return m ? m[1] : null
  }

  function getSessionUser(req) {
    const token = req.cookies?.dcb_session || getBearerToken(req)
    if (!token) return null
    try {
      return jwt.verify(token, sessionSecret)
    } catch (_) {
      return null
    }
  }

  function requireAuth(req, res, next) {
    const user = getSessionUser(req)
    if (!user) return res.status(401).json({ error: 'unauthorized' })
    req.user = user
    return next()
  }

  async function requireGuildOwner(req, res, next) {
    try {
      const guildId = req.params.guildId || req.body.guild_id || req.query.guild_id
      if (!guildId) return res.status(400).json({ error: 'missing_guild_id' })
      const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId)
      if (!guild?.ownerId) return res.status(403).json({ error: 'cannot_determine_owner' })
      // Resolve the Discord ID: if logged in via Google, look up the linked Discord account
      let discordId = req.user.id
      if (discordId?.startsWith('google:') && req.user.google_id) {
        const account = await db.get('SELECT discord_id FROM user_accounts WHERE google_id = ?', [req.user.google_id])
        if (account?.discord_id) discordId = account.discord_id
      }
      if (!discordId || discordId !== guild.ownerId) return res.status(403).json({ error: 'forbidden_not_guild_owner' })
      req.guild = guild
      return next()
    } catch (_) {
      return res.status(404).json({ error: 'guild_not_found' })
    }
  }

  async function fetchTextChannel(guildId, channelId) {
    const channel = await discordClient.channels.fetch(channelId)
    if (!channel || !('guildId' in channel) || channel.guildId !== guildId) throw new Error('invalid_channel')
    if (!('send' in channel)) throw new Error('not_text_channel')
    return channel
  }

  // Serve a minimal favicon to avoid 404
  app.get('/favicon.ico', (req, res) => res.status(204).end())

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  // Check which auth providers are configured
  app.get('/api/auth/providers', (req, res) => {
    res.json({
      discord: !!process.env.DISCORD_CLIENT_ID,
      google: !!process.env.GOOGLE_CLIENT_ID,
    })
  })

  app.get('/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID
    if (!clientId) return res.status(500).send('DISCORD_CLIENT_ID not configured')

    // Clear any existing session before starting a new OAuth flow
    clearSessionCookie(res)

    const state = crypto.randomBytes(12).toString('hex')
    res.cookie('dcb_oauth_state', state, { httpOnly: true, sameSite: cookieSameSite, secure: cookieSecure })

    const redirectUri = encodeURIComponent(`${baseUrl(req)}/auth/discord/callback`)
    const scope = encodeURIComponent('identify email guilds')
    const url = `https://discord.com/api/oauth2/authorize?response_type=code&client_id=${clientId}&scope=${scope}&redirect_uri=${redirectUri}&prompt=consent&state=${state}`
    return res.redirect(url)
  })

  app.get('/auth/discord/callback', async (req, res) => {
    const { code, state } = req.query
    const savedState = req.cookies?.dcb_oauth_state

    if (!code) return res.status(400).send('Missing code')
    if (!state || !savedState || state !== savedState) return res.status(400).send('Invalid OAuth state')

    const clientId = process.env.DISCORD_CLIENT_ID
    const clientSecret = process.env.DISCORD_CLIENT_SECRET
    if (!clientId || !clientSecret) return res.status(500).send('OAuth not configured on server')

    try {
      const tokenResp = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${baseUrl(req)}/auth/discord/callback`
      }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })

      const accessToken = tokenResp.data.access_token
      const userResp = await axios.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      })

      // Ensure user_accounts row exists for Discord user
      const discordId = userResp.data.id
      await db.run(
        `INSERT INTO user_accounts (discord_id, last_login_at) VALUES (?, CURRENT_TIMESTAMP)
         ON CONFLICT(discord_id) DO UPDATE SET last_login_at = CURRENT_TIMESTAMP`,
        [discordId]
      )

      // Check if this Discord user has a linked Google account
      const linkedAccount = await db.get('SELECT google_id, google_email, google_picture FROM user_accounts WHERE discord_id = ?', [discordId])

      const payload = {
        id: userResp.data.id,
        username: userResp.data.username,
        discriminator: userResp.data.discriminator,
        avatar: userResp.data.avatar,
        auth_provider: 'discord',
        google_id: linkedAccount?.google_id || null,
        google_email: linkedAccount?.google_email || null,
        google_picture: linkedAccount?.google_picture || null,
      }

      const jwtToken = jwt.sign(payload, sessionSecret, { expiresIn: 60 * 60 * 24 * 30 }) // 30 days

      res.cookie('dcb_session', jwtToken, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
        maxAge: 60 * 60 * 24 * 30 * 1000
      })

      res.clearCookie('dcb_oauth_state')

      if (uiBase) {
        const u = new URL(uiBase)
        u.searchParams.set('dcb_token', jwtToken)
        return res.redirect(u.toString())
      }
      return res.json({ ok: true })
    } catch (_) {
      return res.status(500).send('OAuth exchange failed')
    }
  })

  const clearSessionCookie = (res) => {
    res.clearCookie('dcb_session', { httpOnly: true, secure: cookieSecure, sameSite: cookieSameSite, path: '/' })
  }

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(res)
    res.json({ ok: true })
  })

  // ---- Google OAuth ----
  app.get('/auth/google', (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID
    if (!clientId) return res.status(500).send('GOOGLE_CLIENT_ID not configured')

    // Clear any existing session before starting a new OAuth flow
    clearSessionCookie(res)

    const state = crypto.randomBytes(12).toString('hex')
    res.cookie('dcb_google_state', state, { httpOnly: true, sameSite: cookieSameSite, secure: cookieSecure })

    const redirectUri = encodeURIComponent(`${baseUrl(req)}/auth/google/callback`)
    const scope = encodeURIComponent('openid email profile')
    const url = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&scope=${scope}&redirect_uri=${redirectUri}&state=${state}&access_type=offline&prompt=consent`
    return res.redirect(url)
  })

  app.get('/auth/google/callback', async (req, res) => {
    const { code, state } = req.query
    const savedState = req.cookies?.dcb_google_state

    if (!code) return res.status(400).send('Missing code')
    if (!state || !savedState || state !== savedState) return res.status(400).send('Invalid OAuth state')

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    if (!clientId || !clientSecret) return res.status(500).send('Google OAuth not configured on server')

    try {
      // Exchange code for tokens
      const tokenResp = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${baseUrl(req)}/auth/google/callback`
      }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })

      const accessToken = tokenResp.data.access_token

      // Get Google user info
      const userResp = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      })

      const googleUser = userResp.data
      const googleId = googleUser.id
      const googleEmail = googleUser.email
      const googleName = googleUser.name
      const googlePicture = googleUser.picture

      // Check if this Google account is already linked to a Discord user
      let account = await db.get('SELECT * FROM user_accounts WHERE google_id = ?', [googleId])

      if (!account) {
        // Check if there's a linked-but-not-Google account being created now
        // For first-time Google login, we need a Discord link. Check if we're linking.
        const linkingDiscordId = req.cookies?.dcb_linking_discord_id
        if (linkingDiscordId) {
          // Link Google to existing Discord account
          const existing = await db.get('SELECT * FROM user_accounts WHERE discord_id = ?', [linkingDiscordId])
          if (existing) {
            await db.run('UPDATE user_accounts SET google_id = ?, google_email = ?, google_name = ?, google_picture = ?, last_login_at = CURRENT_TIMESTAMP WHERE discord_id = ?',
              [googleId, googleEmail, googleName, googlePicture, linkingDiscordId])
          } else {
            await db.run('INSERT INTO user_accounts (discord_id, google_id, google_email, google_name, google_picture) VALUES (?, ?, ?, ?, ?)',
              [linkingDiscordId, googleId, googleEmail, googleName, googlePicture])
          }
          account = await db.get('SELECT * FROM user_accounts WHERE google_id = ?', [googleId])
          res.clearCookie('dcb_linking_discord_id')
        } else {
          // Create new account without Discord link
          // User will need to link Discord later for full guild access
          await db.run('INSERT OR IGNORE INTO user_accounts (google_id, google_email, google_name, google_picture) VALUES (?, ?, ?, ?)',
            [googleId, googleEmail, googleName, googlePicture])
          account = await db.get('SELECT * FROM user_accounts WHERE google_id = ?', [googleId])
        }
      } else {
        // Update profile info
        await db.run('UPDATE user_accounts SET google_email = ?, google_name = ?, google_picture = ?, last_login_at = CURRENT_TIMESTAMP WHERE google_id = ?',
          [googleEmail, googleName, googlePicture, googleId])
      }

      // If we have a linked Discord ID, issue a full JWT with Discord id
      const payload = {
        id: account?.discord_id || `google:${googleId}`,
        username: googleName || googleEmail,
        discriminator: '0',
        avatar: null,
        google_id: googleId,
        google_email: googleEmail,
        google_picture: googlePicture,
        auth_provider: 'google'
      }

      const jwtToken = jwt.sign(payload, sessionSecret, { expiresIn: 60 * 60 * 24 * 30 }) // 30 days for Google

      res.cookie('dcb_session', jwtToken, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
        maxAge: 60 * 60 * 24 * 30 * 1000
      })
      res.clearCookie('dcb_google_state')

      if (uiBase) {
        const u = new URL(uiBase)
        u.searchParams.set('dcb_token', jwtToken)
        return res.redirect(u.toString())
      }
      return res.json({ ok: true })
    } catch (err) {
      console.error('[auth/google] OAuth error:', err?.response?.data || err?.message || err)
      return res.status(500).send('Google OAuth exchange failed')
    }
  })

  // Start linking flow: set cookie then redirect to Google
  app.get('/auth/google/link', requireAuth, (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID
    if (!clientId) return res.status(500).send('GOOGLE_CLIENT_ID not configured')

    // Remember the Discord user we're linking
    res.cookie('dcb_linking_discord_id', req.user.id, { httpOnly: true, sameSite: cookieSameSite, secure: cookieSecure, maxAge: 600_000 })

    const state = crypto.randomBytes(12).toString('hex')
    res.cookie('dcb_google_state', state, { httpOnly: true, sameSite: cookieSameSite, secure: cookieSecure })

    const redirectUri = encodeURIComponent(`${baseUrl(req)}/auth/google/callback`)
    const scope = encodeURIComponent('openid email profile')
    const url = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&scope=${scope}&redirect_uri=${redirectUri}&state=${state}&access_type=offline&prompt=consent`
    return res.redirect(url)
  })

  // Link Discord to an existing Google-only session
  app.post('/auth/link-discord', requireAuth, async (req, res) => {
    try {
      if (!req.user.google_id) return res.status(400).json({ error: 'not_google_session' })
      // The user must already have a Discord session first, then link
      // For now, support linking by having them do Discord OAuth, which sets a discord_id
      return res.status(400).json({ error: 'use_discord_oauth_to_link', message: 'Log in with Discord first, then link Google from settings.' })
    } catch (err) {
      res.status(500).json({ error: 'link_failed' })
    }
  })

  // ---- User Preferences (persist selections across sessions) ----
  app.get('/api/user/preferences', requireAuth, async (req, res) => {
    try {
      const prefs = await db.get('SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id])
      res.json(prefs || { selected_guild_id: null, selected_page: 'dashboard' })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_preferences' })
    }
  })

  app.put('/api/user/preferences', requireAuth, async (req, res) => {
    try {
      const { selected_guild_id, selected_page, extra_json } = req.body || {}
      await db.run(
        `INSERT INTO user_preferences (user_id, selected_guild_id, selected_page, extra_json, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           selected_guild_id = COALESCE(excluded.selected_guild_id, user_preferences.selected_guild_id),
           selected_page = COALESCE(excluded.selected_page, user_preferences.selected_page),
           extra_json = COALESCE(excluded.extra_json, user_preferences.extra_json),
           updated_at = CURRENT_TIMESTAMP`,
        [req.user.id, selected_guild_id || null, selected_page || 'dashboard', extra_json ? JSON.stringify(extra_json) : null]
      )
      const prefs = await db.get('SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id])
      res.json(prefs)
    } catch (err) {
      res.status(500).json({ error: 'failed_to_save_preferences' })
    }
  })

  // ---- Account info (linked providers) ----
  app.get('/api/user/account', requireAuth, async (req, res) => {
    try {
      const account = await db.get('SELECT * FROM user_accounts WHERE discord_id = ? OR google_id = ?',
        [req.user.id, req.user.google_id || null])
      res.json({
        discord_linked: !!account?.discord_id,
        google_linked: !!account?.google_id,
        google_email: account?.google_email || null,
        google_name: account?.google_name || null,
        google_picture: account?.google_picture || null,
      })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_account' })
    }
  })

  app.get('/api/auth/me', (req, res) => {
    const user = getSessionUser(req)
    if (!user) return res.status(401).json({ error: 'no_session' })
    return res.json({ user })
  })

  app.get('/api/admin/guilds', requireAuth, async (req, res) => {
    // Resolve Discord ID for Google-linked accounts
    let discordId = req.user.id
    if (discordId?.startsWith('google:') && req.user.google_id) {
      const account = await db.get('SELECT discord_id FROM user_accounts WHERE google_id = ?', [req.user.google_id])
      if (account?.discord_id) discordId = account.discord_id
    }
    const results = []
    for (const g of discordClient.guilds.cache.values()) {
      try {
        const guild = await g.fetch()
        if (guild.ownerId === discordId) results.push({ id: guild.id, name: guild.name })
      } catch (_) {
      }
    }
    res.json(results)
  })

  app.get('/api/admin/guilds/:guildId/channels', requireAuth, requireGuildOwner, async (req, res) => {
    const channels = await req.guild.channels.fetch()
    const out = []
    for (const c of channels.values()) {
      if (c && (c.type === 0 || c.type === 5)) out.push({ id: c.id, name: c.name, type: c.type })
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    res.json(out)
  })

  app.get('/api/admin/guilds/:guildId/tasks', requireAuth, requireGuildOwner, async (req, res) => {
    const rows = await db.all('SELECT * FROM tasks WHERE guild_id = ? ORDER BY id DESC', [req.guild.id])
    res.json(rows)
  })

  app.post('/api/admin/guilds/:guildId/tasks', requireAuth, requireGuildOwner, async (req, res) => {
    const { recipient_address, amount, description } = req.body || {}
    if (!recipient_address || amount == null) return res.status(400).json({ error: 'missing_fields' })
    const r = await db.run(
      'INSERT INTO tasks (guild_id, creator_id, recipient_address, amount, description) VALUES (?, ?, ?, ?, ?)',
      [req.guild.id, req.user.id, String(recipient_address), Number(amount), String(description || '')]
    )
    const task = await db.get('SELECT * FROM tasks WHERE id = ?', [r.lastID])
    res.json(task)
  })

  app.get('/api/admin/guilds/:guildId/contests', requireAuth, requireGuildOwner, async (req, res) => {
    const rows = await db.all('SELECT * FROM contests WHERE guild_id = ? ORDER BY id DESC', [req.guild.id])
    res.json(rows)
  })

  app.post('/api/admin/guilds/:guildId/contests', requireAuth, requireGuildOwner, async (req, res) => {
    const {
      channel_id,
      title,
      description,
      prize_amount,
      currency,
      num_winners,
      max_entries,
      duration_hours,
      reference_url,
    } = req.body || {}

    if (!channel_id || !title || prize_amount == null || !max_entries || !duration_hours || !reference_url) {
      return res.status(400).json({ error: 'missing_fields' })
    }

    const endsAt = new Date(Date.now() + (Number(duration_hours) * 60 * 60 * 1000)).toISOString()

    const r = await db.run(
      `INSERT INTO contests (guild_id, channel_id, title, description, prize_amount, currency, num_winners, max_entries, duration_hours, reference_url, created_by, ends_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.guild.id,
        String(channel_id),
        String(title),
        String(description || ''),
        Number(prize_amount),
        String(currency || 'USD'),
        Number(num_winners || 1),
        Number(max_entries),
        Number(duration_hours),
        String(reference_url),
        req.user.id,
        endsAt,
      ]
    )

    const contest = await db.get('SELECT * FROM contests WHERE id = ?', [r.lastID])
    res.json(contest)
  })

  app.post('/api/admin/guilds/:guildId/contests/:contestId/publish', requireAuth, requireGuildOwner, async (req, res) => {
    const contestId = Number(req.params.contestId)
    const contest = await db.get('SELECT * FROM contests WHERE id = ?', [contestId])
    if (!contest || contest.guild_id !== req.guild.id) return res.status(404).json({ error: 'contest_not_found' })

    const channelId = req.body?.channel_id || contest.channel_id
    const channel = await fetchTextChannel(req.guild.id, channelId)
    const endTimestamp = contest.ends_at ? Math.floor(new Date(contest.ends_at).getTime() / 1000) : null

    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle(`🏆 ${contest.title}`)
      .setDescription(contest.description || '')
      .addFields(
        { name: '🎁 Prize', value: `${contest.prize_amount} ${contest.currency}`, inline: true },
        { name: '👑 Winners', value: `${contest.num_winners}`, inline: true },
        { name: '🎟️ Entries', value: `${contest.current_entries}/${contest.max_entries}`, inline: true },
        { name: '🔗 Reference', value: contest.reference_url }
      )
      .setFooter({ text: `Contest #${contestId}` })
      .setTimestamp()

    if (endTimestamp) embed.addFields({ name: '⏱️ Ends', value: `<t:${endTimestamp}:R>`, inline: true })

    const enterButton = new ButtonBuilder()
      .setCustomId(`contest_enter_${contestId}`)
      .setLabel('🎫 Enter Contest')
      .setStyle(ButtonStyle.Primary)

    const infoButton = new ButtonBuilder()
      .setCustomId(`contest_info_${contestId}`)
      .setLabel('ℹ️ Info')
      .setStyle(ButtonStyle.Secondary)

    const msg = await channel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(enterButton, infoButton)],
    })

    await db.run('UPDATE contests SET message_id = ?, channel_id = ? WHERE id = ?', [msg.id, String(channelId), contestId])

    res.json({ ok: true, message_id: msg.id, channel_id: String(channelId) })
  })

  app.get('/api/admin/guilds/:guildId/bulk-tasks', requireAuth, requireGuildOwner, async (req, res) => {
    const rows = await db.all('SELECT * FROM bulk_tasks WHERE guild_id = ? ORDER BY id DESC', [req.guild.id])
    res.json(rows)
  })

  app.post('/api/admin/guilds/:guildId/bulk-tasks', requireAuth, requireGuildOwner, async (req, res) => {
    const { title, description, payout_amount, payout_currency, total_slots } = req.body || {}
    if (!title || payout_amount == null || !total_slots) return res.status(400).json({ error: 'missing_fields' })
    const r = await db.run(
      `INSERT INTO bulk_tasks (guild_id, title, description, payout_amount, payout_currency, total_slots, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.guild.id, String(title), String(description || ''), Number(payout_amount), String(payout_currency || 'SOL'), Number(total_slots), req.user.id]
    )
    const task = await db.get('SELECT * FROM bulk_tasks WHERE id = ?', [r.lastID])
    res.json(task)
  })

  app.post('/api/admin/guilds/:guildId/bulk-tasks/:taskId/publish', requireAuth, requireGuildOwner, async (req, res) => {
    const taskId = Number(req.params.taskId)
    const task = await db.get('SELECT * FROM bulk_tasks WHERE id = ?', [taskId])
    if (!task || task.guild_id !== req.guild.id) return res.status(404).json({ error: 'bulk_task_not_found' })

    const channelId = req.body?.channel_id || task.channel_id
    if (!channelId) return res.status(400).json({ error: 'missing_channel_id' })
    const channel = await fetchTextChannel(req.guild.id, channelId)

    const available = Number(task.total_slots) - Number(task.filled_slots)

    const embed = new EmbedBuilder()
      .setColor('#3498DB')
      .setTitle(`📋 ${task.title}`)
      .setDescription(task.description || '')
      .addFields(
        { name: '💰 Payout', value: `${task.payout_amount} ${task.payout_currency}`, inline: true },
        { name: '🎟️ Slots', value: `${available}/${task.total_slots} available`, inline: true },
        { name: '📊 Status', value: task.status, inline: true }
      )
      .setFooter({ text: `Bulk Task #${taskId}` })
      .setTimestamp()

    const claimButton = new ButtonBuilder()
      .setCustomId(`bulk_task_claim_${taskId}`)
      .setLabel('🙋 Claim Slot')
      .setStyle(ButtonStyle.Primary)

    const msg = await channel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(claimButton)],
    })

    await db.run('UPDATE bulk_tasks SET message_id = ?, channel_id = ? WHERE id = ?', [msg.id, String(channelId), taskId])

    res.json({ ok: true, message_id: msg.id, channel_id: String(channelId) })
  })

  app.get('/api/admin/guilds/:guildId/vote-events', requireAuth, requireGuildOwner, async (req, res) => {
    const rows = await db.all('SELECT * FROM vote_events WHERE guild_id = ? ORDER BY id DESC', [req.guild.id])
    res.json(rows)
  })

  app.post('/api/admin/guilds/:guildId/vote-events', requireAuth, requireGuildOwner, async (req, res) => {
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
      images,
    } = req.body || {}

    if (!channel_id || !title || !description) return res.status(400).json({ error: 'missing_fields' })
    if (!min_participants || !max_participants) return res.status(400).json({ error: 'missing_participant_limits' })
    if (!Array.isArray(images) || images.length < 2) return res.status(400).json({ error: 'at_least_two_images_required' })

    const endsAt = duration_minutes ? new Date(Date.now() + (Number(duration_minutes) * 60 * 1000)).toISOString() : null

    const r = await db.run(
      `INSERT INTO vote_events (guild_id, channel_id, title, description, prize_amount, currency, min_participants, max_participants, duration_minutes, owner_favorite_image_id, created_by, ends_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.guild.id,
        String(channel_id),
        String(title),
        String(description),
        Number(prize_amount || 0),
        String(currency || 'USD'),
        Number(min_participants),
        Number(max_participants),
        duration_minutes == null ? null : Number(duration_minutes),
        owner_favorite_image_id || null,
        req.user.id,
        endsAt,
      ]
    )

    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      if (!img || !img.id || !img.url) continue
      await db.run(
        'INSERT INTO vote_event_images (vote_event_id, image_id, image_url, upload_order) VALUES (?, ?, ?, ?)',
        [r.lastID, String(img.id), String(img.url), i + 1]
      )
    }

    const event = await db.get('SELECT * FROM vote_events WHERE id = ?', [r.lastID])
    res.json(event)
  })

  app.post('/api/admin/guilds/:guildId/vote-events/:eventId/publish', requireAuth, requireGuildOwner, async (req, res) => {
    const eventId = Number(req.params.eventId)
    const event = await db.get('SELECT * FROM vote_events WHERE id = ?', [eventId])
    if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'vote_event_not_found' })

    const channelId = req.body?.channel_id || event.channel_id
    const channel = await fetchTextChannel(req.guild.id, channelId)
    const images = await db.all('SELECT * FROM vote_event_images WHERE vote_event_id = ? ORDER BY upload_order ASC', [eventId])

    const endTimestamp = event.ends_at ? Math.floor(new Date(event.ends_at).getTime() / 1000) : null

    const embed = new EmbedBuilder()
      .setColor('#9B59B6')
      .setTitle(`🗳️ ${event.title}`)
      .setDescription(event.description || '')
      .addFields(
        { name: '👥 Participants', value: `${event.current_participants}/${event.max_participants}`, inline: true },
        { name: '✅ Min to Start', value: `${event.min_participants}`, inline: true },
        { name: '🎁 Prize', value: `${Number(event.prize_amount || 0)} ${event.currency}`, inline: true }
      )
      .setFooter({ text: `Event #${eventId}` })
      .setTimestamp()

    if (endTimestamp) embed.addFields({ name: '⏱️ Ends', value: `<t:${endTimestamp}:R>`, inline: true })
    if (images && images[0]?.image_url) embed.setImage(images[0].image_url)

    const joinButton = new ButtonBuilder()
      .setCustomId(`vote_event_join_${eventId}`)
      .setLabel('🎫 Join Event')
      .setStyle(ButtonStyle.Success)

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
      )

    const msg = await channel.send({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(joinButton),
        new ActionRowBuilder().addComponents(selectMenu),
      ]
    })

    await db.run('UPDATE vote_events SET message_id = ?, channel_id = ? WHERE id = ?', [msg.id, String(channelId), eventId])

    res.json({ ok: true, message_id: msg.id, channel_id: String(channelId) })
  })

  // ---- Dashboard Stats ----
  app.get('/api/admin/guilds/:guildId/dashboard/stats', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const gid = req.guild.id
      const [activeTasks, pendingProofs, workers, liveContests, activeEvents] = await Promise.all([
        db.get('SELECT COUNT(*) as cnt FROM bulk_tasks WHERE guild_id = ? AND status = ?', [gid, 'active']),
        db.get('SELECT COUNT(*) as cnt FROM proof_submissions WHERE guild_id = ? AND status = ?', [gid, 'pending']),
        db.get('SELECT COUNT(DISTINCT assigned_user_id) as cnt FROM task_assignments WHERE guild_id = ?', [gid]),
        db.get('SELECT COUNT(*) as cnt FROM contests WHERE guild_id = ? AND status = ?', [gid, 'active']),
        db.get('SELECT COUNT(*) as cnt FROM events WHERE guild_id = ? AND status IN (?, ?)', [gid, 'scheduled', 'active']),
      ])
      res.json({
        activeTasks: activeTasks?.cnt || 0,
        pendingProofs: pendingProofs?.cnt || 0,
        workers: workers?.cnt || 0,
        liveContests: liveContests?.cnt || 0,
        activeEvents: activeEvents?.cnt || 0,
      })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_stats' })
    }
  })

  app.get('/api/admin/guilds/:guildId/dashboard/activity', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 20
      const type = req.query.type || null
      let sql = 'SELECT * FROM activity_feed WHERE guild_id = ?'
      const params = [req.guild.id]
      if (type && type !== 'all') { sql += ' AND type = ?'; params.push(type) }
      sql += ' ORDER BY created_at DESC LIMIT ?'
      params.push(limit)
      const rows = await db.all(sql, params)
      res.json(rows || [])
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_activity' })
    }
  })

  app.get('/api/admin/guilds/:guildId/dashboard/balance', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const wallet = await db.get('SELECT * FROM guild_wallets WHERE guild_id = ?', [req.guild.id])
      let sol_balance = null
      let debug = { wallet_address: wallet?.wallet_address || null, network: wallet?.network || null, rpc_url: null, raw_lamports: null, rpc_error: null }
      if (wallet?.wallet_address) {
        try {
          const rpcUrl = wallet.network === 'devnet'
            ? 'https://api.devnet.solana.com'
            : (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com')
          debug.rpc_url = rpcUrl
          console.log(`[balance] Querying ${rpcUrl} for wallet ${wallet.wallet_address} (network: ${wallet.network})`)
          const rpcRes = await axios.post(rpcUrl, {
            jsonrpc: '2.0', id: 1, method: 'getBalance', params: [wallet.wallet_address]
          }, { timeout: 8000 })
          console.log(`[balance] RPC response:`, JSON.stringify(rpcRes.data))
          if (rpcRes.data?.result?.value !== undefined) {
            debug.raw_lamports = rpcRes.data.result.value
            sol_balance = rpcRes.data.result.value / 1e9
          }
          if (rpcRes.data?.error) {
            debug.rpc_error = rpcRes.data.error
          }
        } catch (e) {
          debug.rpc_error = e.message
          console.error(`[balance] RPC error:`, e.message)
        }
      }
      res.json({ wallet_address: wallet?.wallet_address || null, wallet, sol_balance, debug })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_balance' })
    }
  })

  // ---- Guild Treasury Wallet Management ----
  app.get('/api/admin/guilds/:guildId/wallet', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const wallet = await db.get('SELECT * FROM guild_wallets WHERE guild_id = ?', [req.guild.id])
      res.json(wallet || null)
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_wallet' })
    }
  })

  app.post('/api/admin/guilds/:guildId/wallet', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { wallet_address, label, network } = req.body || {}
      if (!wallet_address || typeof wallet_address !== 'string' || wallet_address.length < 32 || wallet_address.length > 44) {
        return res.status(400).json({ error: 'invalid_wallet_address' })
      }
      await db.run(
        `INSERT INTO guild_wallets (guild_id, wallet_address, configured_by, label, network, configured_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(guild_id) DO UPDATE SET
           wallet_address = excluded.wallet_address,
           configured_by = excluded.configured_by,
           label = excluded.label,
           network = excluded.network,
           updated_at = CURRENT_TIMESTAMP`,
        [req.guild.id, wallet_address.trim(), req.user.id, label || 'Treasury', network || 'mainnet-beta']
      )
      await db.run(
        'INSERT INTO activity_feed (guild_id, type, title, description, user_tag, amount, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.guild.id, 'wallet', 'Treasury Wallet Connected', `Wallet ${wallet_address.slice(0,8)}...${wallet_address.slice(-4)} connected`, `@${req.user.username}`, 0, 'SOL']
      )
      const wallet = await db.get('SELECT * FROM guild_wallets WHERE guild_id = ?', [req.guild.id])
      res.json(wallet)
    } catch (err) {
      res.status(500).json({ error: 'failed_to_set_wallet' })
    }
  })

  app.patch('/api/admin/guilds/:guildId/wallet', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const updates = req.body || {}
      const fields = []; const params = []
      if (updates.wallet_address !== undefined) { fields.push('wallet_address = ?'); params.push(updates.wallet_address) }
      if (updates.label !== undefined) { fields.push('label = ?'); params.push(updates.label) }
      if (updates.budget_total !== undefined) { fields.push('budget_total = ?'); params.push(Number(updates.budget_total)) }
      if (updates.budget_spent !== undefined) { fields.push('budget_spent = ?'); params.push(Number(updates.budget_spent)) }
      if (updates.budget_currency !== undefined) { fields.push('budget_currency = ?'); params.push(updates.budget_currency) }
      if (updates.network !== undefined) { fields.push('network = ?'); params.push(updates.network) }
      if (fields.length) {
        fields.push('updated_at = CURRENT_TIMESTAMP')
        params.push(req.guild.id)
        await db.run(`UPDATE guild_wallets SET ${fields.join(', ')} WHERE guild_id = ?`, params)
      }
      const wallet = await db.get('SELECT * FROM guild_wallets WHERE guild_id = ?', [req.guild.id])
      res.json(wallet)
    } catch (err) {
      res.status(500).json({ error: 'failed_to_update_wallet' })
    }
  })

  app.delete('/api/admin/guilds/:guildId/wallet', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      await db.run('DELETE FROM guild_wallets WHERE guild_id = ?', [req.guild.id])
      await db.run(
        'INSERT INTO activity_feed (guild_id, type, title, description, user_tag, amount, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.guild.id, 'wallet', 'Treasury Wallet Disconnected', 'Treasury wallet removed', `@${req.user.username}`, 0, 'SOL']
      )
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_delete_wallet' })
    }
  })

  app.post('/api/admin/guilds/:guildId/wallet/budget', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { budget_total, budget_currency } = req.body || {}
      if (budget_total == null || Number(budget_total) < 0) return res.status(400).json({ error: 'invalid_budget' })
      await db.run('UPDATE guild_wallets SET budget_total = ?, budget_currency = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [Number(budget_total), budget_currency || 'SOL', req.guild.id])
      const wallet = await db.get('SELECT * FROM guild_wallets WHERE guild_id = ?', [req.guild.id])
      res.json(wallet)
    } catch (err) {
      res.status(500).json({ error: 'failed_to_set_budget' })
    }
  })

  app.post('/api/admin/guilds/:guildId/wallet/budget/reset', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      await db.run('UPDATE guild_wallets SET budget_spent = 0, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [req.guild.id])
      const wallet = await db.get('SELECT * FROM guild_wallets WHERE guild_id = ?', [req.guild.id])
      res.json(wallet)
    } catch (err) {
      res.status(500).json({ error: 'failed_to_reset_budget' })
    }
  })

  // ---- Transaction History ----
  app.get('/api/admin/guilds/:guildId/transactions', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50
      const rows = await db.all('SELECT * FROM transactions WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?', [req.guild.id, limit])
      res.json(rows || [])
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_transactions' })
    }
  })

  // ---- Events (Scheduled Events) ----
  app.get('/api/admin/guilds/:guildId/events', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const rows = await db.all('SELECT * FROM events WHERE guild_id = ? ORDER BY created_at DESC', [req.guild.id])
      res.json(rows || [])
    } catch (err) {
      res.status(500).json({ error: 'failed_to_list_events' })
    }
  })

  app.post('/api/admin/guilds/:guildId/events', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { channel_id, title, description, event_type, prize_amount, currency, max_participants, starts_at, ends_at } = req.body || {}
      if (!title) return res.status(400).json({ error: 'missing_title' })
      const r = await db.run(
        `INSERT INTO events (guild_id, channel_id, title, description, event_type, prize_amount, currency, max_participants, starts_at, ends_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.guild.id, channel_id || null, String(title), description || '', event_type || 'general', Number(prize_amount || 0), currency || 'SOL', max_participants ? Number(max_participants) : null, starts_at || null, ends_at || null, req.user.id]
      )
      // Log activity
      await db.run(
        'INSERT INTO activity_feed (guild_id, type, title, description, user_tag, amount, currency, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [req.guild.id, 'event', 'Event Scheduled', title, `@${req.user.username}`, Number(prize_amount || 0), currency || 'SOL', r.lastID]
      )
      const event = await db.get('SELECT * FROM events WHERE id = ?', [r.lastID])
      res.json(event)
    } catch (err) {
      res.status(500).json({ error: 'failed_to_create_event' })
    }
  })

  app.patch('/api/admin/guilds/:guildId/events/:eventId/status', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const { status } = req.body || {}
      if (!status) return res.status(400).json({ error: 'missing_status' })
      await db.run('UPDATE events SET status = ? WHERE id = ?', [status, eventId])
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_update_event' })
    }
  })

  app.delete('/api/admin/guilds/:guildId/events/:eventId', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      await db.run('DELETE FROM events WHERE id = ?', [eventId])
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_delete_event' })
    }
  })

  // ---- Workers / DCB Roles ----

  // ---- Proof Submissions ----
  app.get('/api/admin/guilds/:guildId/proofs', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const status = req.query.status || 'pending'
      const limit = Math.min(Number(req.query.limit) || 100, 500)
      let sql, params
      if (status === 'all') {
        sql = `SELECT ps.*, ta.assigned_user_id, bt.title, bt.payout_amount, bt.payout_currency
               FROM proof_submissions ps
               LEFT JOIN task_assignments ta ON ps.task_assignment_id = ta.id
               LEFT JOIN bulk_tasks bt ON ta.bulk_task_id = bt.id
               WHERE ps.guild_id = ? ORDER BY ps.submitted_at DESC LIMIT ?`
        params = [req.guild.id, limit]
      } else {
        sql = `SELECT ps.*, ta.assigned_user_id, bt.title, bt.payout_amount, bt.payout_currency
               FROM proof_submissions ps
               LEFT JOIN task_assignments ta ON ps.task_assignment_id = ta.id
               LEFT JOIN bulk_tasks bt ON ta.bulk_task_id = bt.id
               WHERE ps.guild_id = ? AND ps.status = ? ORDER BY ps.submitted_at DESC LIMIT ?`
        params = [req.guild.id, status, limit]
      }
      const rows = await db.all(sql, params)
      res.json(rows || [])
    } catch (err) {
      console.error('[proofs] GET error:', err?.message || err)
      res.status(500).json({ error: 'failed_to_get_proofs' })
    }
  })

  app.get('/api/admin/guilds/:guildId/proofs/:proofId', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const proof = await db.get(
        `SELECT ps.*, ta.assigned_user_id, ta.bulk_task_id, bt.title, bt.payout_amount, bt.payout_currency
         FROM proof_submissions ps
         LEFT JOIN task_assignments ta ON ps.task_assignment_id = ta.id
         LEFT JOIN bulk_tasks bt ON ta.bulk_task_id = bt.id
         WHERE ps.id = ? AND ps.guild_id = ?`,
        [Number(req.params.proofId), req.guild.id]
      )
      if (!proof) return res.status(404).json({ error: 'proof_not_found' })
      res.json(proof)
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_proof' })
    }
  })

  app.post('/api/admin/guilds/:guildId/proofs/:proofId/approve', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const proofId = Number(req.params.proofId)
      const proof = await db.get('SELECT * FROM proof_submissions WHERE id = ? AND guild_id = ?', [proofId, req.guild.id])
      if (!proof) return res.status(404).json({ error: 'proof_not_found' })
      if (proof.status !== 'pending') return res.status(400).json({ error: 'proof_not_pending' })
      await db.run('UPDATE proof_submissions SET status = ?, approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ?', ['approved', req.user.id, proofId])
      await db.run('UPDATE task_assignments SET status = ? WHERE id = ?', ['approved', proof.task_assignment_id])
      // Log to activity feed
      await db.run('INSERT INTO activity_feed (guild_id, type, title, description, user_tag) VALUES (?, ?, ?, ?, ?)',
        [req.guild.id, 'proof', 'Proof Approved', `Proof #${proofId} approved`, `@${req.user.username}`])
      // If pay requested, record a transaction placeholder
      if (req.body?.pay) {
        const proofDetail = await db.get(
          `SELECT ps.*, bt.payout_amount, bt.payout_currency, ta.assigned_user_id FROM proof_submissions ps
           LEFT JOIN task_assignments ta ON ps.task_assignment_id = ta.id
           LEFT JOIN bulk_tasks bt ON ta.bulk_task_id = bt.id WHERE ps.id = ?`, [proofId])
        if (proofDetail?.payout_amount) {
          await db.run(
            'INSERT INTO transactions (guild_id, type, amount, currency, recipient_id, description) VALUES (?, ?, ?, ?, ?, ?)',
            [req.guild.id, 'payout', proofDetail.payout_amount, proofDetail.payout_currency || 'SOL', proofDetail.assigned_user_id, `Task proof #${proofId} approved & paid`])
        }
      }
      res.json({ ok: true })
    } catch (err) {
      console.error('[proofs] approve error:', err?.message || err)
      res.status(500).json({ error: 'failed_to_approve_proof' })
    }
  })

  app.post('/api/admin/guilds/:guildId/proofs/:proofId/reject', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const proofId = Number(req.params.proofId)
      const proof = await db.get('SELECT * FROM proof_submissions WHERE id = ? AND guild_id = ?', [proofId, req.guild.id])
      if (!proof) return res.status(404).json({ error: 'proof_not_found' })
      if (proof.status !== 'pending') return res.status(400).json({ error: 'proof_not_pending' })
      const reason = req.body?.reason || 'Rejected by admin'
      await db.run('UPDATE proof_submissions SET status = ?, rejection_reason = ?, approved_by = ? WHERE id = ?', ['rejected', reason, req.user.id, proofId])
      await db.run('UPDATE task_assignments SET status = ? WHERE id = ?', ['assigned', proof.task_assignment_id])
      await db.run('INSERT INTO activity_feed (guild_id, type, title, description, user_tag) VALUES (?, ?, ?, ?, ?)',
        [req.guild.id, 'proof', 'Proof Rejected', `Proof #${proofId} rejected: ${reason}`, `@${req.user.username}`])
      res.json({ ok: true })
    } catch (err) {
      console.error('[proofs] reject error:', err?.message || err)
      res.status(500).json({ error: 'failed_to_reject_proof' })
    }
  })

  app.get('/api/admin/guilds/:guildId/workers', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const days = Number(req.query.days) || 30
      const rows = await db.all(
        `SELECT
           dw.discord_id, dw.username, dw.role, dw.added_at,
           COALESCE(SUM(wds.commands_run), 0) as total_commands,
           COALESCE(SUM(wds.messages_sent), 0) as total_messages,
           COALESCE(SUM(wds.payouts_issued), 0) as total_payouts_issued,
           COALESCE(SUM(wds.payout_total), 0) as total_payout_amount,
           COALESCE(SUM(wds.proofs_reviewed), 0) as total_proofs_reviewed,
           COALESCE(SUM(wds.online_minutes), 0) as total_online_minutes,
           COUNT(DISTINCT wds.stat_date) as active_days,
           (SELECT MAX(wa2.created_at) FROM worker_activity wa2 WHERE wa2.guild_id = dw.guild_id AND wa2.discord_id = dw.discord_id) as last_active
         FROM dcb_workers dw
         LEFT JOIN worker_daily_stats wds ON dw.guild_id = wds.guild_id AND dw.discord_id = wds.discord_id
           AND wds.stat_date >= date('now', '-' || ? || ' days')
         WHERE dw.guild_id = ? AND dw.removed_at IS NULL
         GROUP BY dw.discord_id
         ORDER BY dw.role ASC, total_commands DESC`,
        [days, req.guild.id]
      )
      // Enrich with Discord data
      const enriched = await Promise.all((rows || []).map(async (w) => {
        try {
          const member = await req.guild.members.fetch(w.discord_id)
          return { ...w, avatar: member.user.displayAvatarURL({ size: 64 }), display_name: member.displayName, status: member.presence?.status || 'offline', joined_guild_at: member.joinedAt?.toISOString() || null, account_created_at: member.user.createdAt?.toISOString() || null }
        } catch (_) {
          return { ...w, avatar: null, display_name: w.username, status: 'offline', joined_guild_at: null, account_created_at: null }
        }
      }))
      res.json(enriched)
    } catch (err) {
      console.error('[workers] GET error:', err?.message || err)
      res.status(500).json({ error: 'failed_to_get_workers' })
    }
  })

  app.post('/api/admin/guilds/:guildId/workers', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { discord_id, role } = req.body || {}
      if (!discord_id) return res.status(400).json({ error: 'missing_discord_id' })
      const workerRole = ['staff', 'admin'].includes(role) ? role : 'staff'
      let username = 'unknown'
      try { const m = await req.guild.members.fetch(discord_id); username = m.user.username } catch (_) {}
      await db.run(
        `INSERT INTO dcb_workers (guild_id, discord_id, username, role, added_by) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, discord_id) DO UPDATE SET username=excluded.username, role=excluded.role, added_by=excluded.added_by, removed_at=NULL, added_at=CURRENT_TIMESTAMP`,
        [req.guild.id, discord_id, username, workerRole, req.user.id]
      )
      await db.run('INSERT INTO worker_activity (guild_id, discord_id, action_type, detail) VALUES (?, ?, ?, ?)',
        [req.guild.id, discord_id, 'role_assigned', `Assigned ${workerRole} via dashboard`])
      res.json({ ok: true, role: workerRole, username })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_add_worker' })
    }
  })

  app.patch('/api/admin/guilds/:guildId/workers/:discordId', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { role } = req.body || {}
      if (!['staff', 'admin'].includes(role)) return res.status(400).json({ error: 'invalid_role' })
      await db.run('UPDATE dcb_workers SET role = ? WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL', [role, req.guild.id, req.params.discordId])
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_update_worker' })
    }
  })

  app.delete('/api/admin/guilds/:guildId/workers/:discordId', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      await db.run('UPDATE dcb_workers SET removed_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL', [req.guild.id, req.params.discordId])
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_remove_worker' })
    }
  })

  app.get('/api/admin/guilds/:guildId/workers/:discordId', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const worker = await db.get('SELECT * FROM dcb_workers WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL', [req.guild.id, req.params.discordId])
      if (!worker) return res.status(404).json({ error: 'worker_not_found' })
      const stats = await db.get(
        `SELECT COALESCE(SUM(commands_run),0) as total_commands, COALESCE(SUM(messages_sent),0) as total_messages,
         COALESCE(SUM(payouts_issued),0) as total_payouts_issued, COALESCE(SUM(payout_total),0) as total_payout_amount,
         COALESCE(SUM(proofs_reviewed),0) as total_proofs_reviewed, COALESCE(SUM(online_minutes),0) as total_online_minutes,
         COUNT(DISTINCT stat_date) as active_days
         FROM worker_daily_stats WHERE guild_id = ? AND discord_id = ? AND stat_date >= date('now', '-30 days')`,
        [req.guild.id, req.params.discordId]
      )
      const activity = await db.all('SELECT * FROM worker_activity WHERE guild_id = ? AND discord_id = ? ORDER BY created_at DESC LIMIT 50', [req.guild.id, req.params.discordId])
      let enriched = { ...worker, ...(stats || {}), activity: activity || [] }
      try {
        const member = await req.guild.members.fetch(req.params.discordId)
        enriched.avatar = member.user.displayAvatarURL({ size: 128 })
        enriched.display_name = member.displayName
        enriched.status = member.presence?.status || 'offline'
        enriched.joined_guild_at = member.joinedAt?.toISOString() || null
        enriched.account_created_at = member.user.createdAt?.toISOString() || null
      } catch (_) {}
      res.json(enriched)
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_worker' })
    }
  })

  app.get('/api/admin/guilds/:guildId/workers-activity', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500)
      const rows = await db.all(
        `SELECT wa.*, dw.username, dw.role FROM worker_activity wa
         LEFT JOIN dcb_workers dw ON wa.guild_id = dw.guild_id AND wa.discord_id = dw.discord_id AND dw.removed_at IS NULL
         WHERE wa.guild_id = ? ORDER BY wa.created_at DESC LIMIT ?`,
        [req.guild.id, limit]
      )
      res.json(rows || [])
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_activity' })
    }
  })

  app.get('/api/admin/guilds/:guildId/members', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const members = await req.guild.members.fetch({ limit: 100 })
      const list = members.filter(m => !m.user.bot).map(m => ({
        id: m.id, username: m.user.username, display_name: m.displayName, avatar: m.user.displayAvatarURL({ size: 32 })
      }))
      res.json(list)
    } catch (err) {
      console.error('[members] GET error:', err?.message || err)
      res.status(500).json({ error: 'failed_to_list_members' })
    }
  })

  return app
}
