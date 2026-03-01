const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const jwt = require('jsonwebtoken')
const axios = require('axios')
const crypto = require('crypto')
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js')
const db = require('./db')
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })

module.exports = function buildApi({ discordClient }) {
  const app = express()

  // ---- Secret encryption helpers (AES-256-GCM, mirrors utils/db.js) ----
  const ENCRYPTION_PREFIX = 'enc:';
  const E2E_TRANSPORT_PREFIX = 'e2e:';
  const _getEncKey = () => {
    const hex = process.env.ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) return null;
    return Buffer.from(hex, 'hex');
  };
  const _getTransportKey = () => {
    const hex = process.env.E2E_TRANSPORT_KEY;
    if (hex && hex.length === 64) return Buffer.from(hex, 'hex');
    return _getEncKey(); // fallback to at-rest key
  };
  const isEncryptedValue = (v) => typeof v === 'string' && v.startsWith(ENCRYPTION_PREFIX);
  const isTransportEncrypted = (v) => typeof v === 'string' && v.startsWith(E2E_TRANSPORT_PREFIX);
  const encryptSecret = (plain) => {
    if (!plain) return plain;
    if (isEncryptedValue(plain)) return plain; // already at-rest encrypted — don't double-encrypt
    const key = _getEncKey(); if (!key) return plain;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let enc = cipher.update(plain, 'utf8', 'base64'); enc += cipher.final('base64');
    return `${ENCRYPTION_PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc}`;
  };
  const decryptSecret = (stored) => {
    if (!stored || !stored.startsWith(ENCRYPTION_PREFIX)) return stored;
    const key = _getEncKey(); if (!key) return null;
    try {
      const [ivB64, tagB64, cB64] = stored.slice(ENCRYPTION_PREFIX.length).split(':');
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
      d.setAuthTag(Buffer.from(tagB64, 'base64'));
      let r = d.update(cB64, 'base64', 'utf8'); r += d.final('utf8'); return r;
    } catch { return null; }
  };
  /** Strip E2E transport encryption layer (e2e:iv:tag:ciphertext → plaintext or enc:...) */
  const decryptTransport = (value) => {
    if (!value || !isTransportEncrypted(value)) return value;
    const key = _getTransportKey(); if (!key) return null;
    try {
      const payload = value.slice(E2E_TRANSPORT_PREFIX.length);
      const [ivB64, tagB64, cB64] = payload.split(':');
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
      d.setAuthTag(Buffer.from(tagB64, 'base64'));
      let r = d.update(cB64, 'base64', 'utf8'); r += d.final('utf8'); return r;
    } catch (err) { console.error('[internal] transport decryption failed:', err.message); return null; }
  };

  app.use(express.json())
  app.use(cookieParser())

  const isProd = process.env.NODE_ENV === 'production'
  const uiBase = process.env.DCB_UI_BASE || null
  const publicBase = process.env.DCB_PUBLIC_URL || null
  const cookieSameSite = process.env.DCB_COOKIE_SAMESITE || (isProd ? 'none' : 'lax')
  const cookieSecure = isProd

  const allowedOrigins = (() => {
    const origins = []
    if (uiBase) {
      try { origins.push(new URL(uiBase).origin) } catch (_) { origins.push(uiBase) }
    }
    // Always allow GitHub Pages origin
    origins.push('https://illmedicine.github.io')
    return origins
  })()

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)
      if (allowedOrigins.length === 0) return cb(null, origin) // echo origin when no restriction
      if (allowedOrigins.includes(origin)) return cb(null, origin)
      return cb(null, false)
    },
    credentials: true,
  }))

  function baseUrl(req) {
    if (publicBase) return publicBase.replace(/\/$/, '')
    const proto = req.headers['x-forwarded-proto'] || req.protocol
    return `${proto}://${req.get('host')}`
  }

  // ---- Raw Discord REST helpers (reliable in REST-only mode, no gateway needed) ----
  const BOT_TOKEN = process.env.DISCORD_TOKEN
  async function discordBotAPI(path) {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    })
    if (!res.ok) throw new Error(`Discord API ${res.status}: ${path}`)
    return res.json()
  }

  // POST/PATCH/DELETE via raw REST
  async function discordBotRequest(method, path, body) {
    const opts = {
      method,
      headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }
    }
    if (body !== undefined) opts.body = JSON.stringify(body)
    const res = await fetch(`https://discord.com/api/v10${path}`, opts)
    if (!res.ok) throw new Error(`Discord API ${method} ${res.status}: ${path}`)
    if (res.status === 204) return null
    return res.json()
  }

  // POST with multipart form data (for file uploads)
  async function discordBotUpload(path, formData) {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method: 'POST',
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
      body: formData
    })
    if (!res.ok) throw new Error(`Discord API upload ${res.status}: ${path}`)
    return res.json()
  }

  // Cache guild info fetched via REST (avoids repeated API calls)
  const _guildInfoCache = new Map()
  async function getGuildInfoViaREST(guildId) {
    const cached = _guildInfoCache.get(guildId)
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.data
    try {
      const data = await discordBotAPI(`/guilds/${guildId}`)
      _guildInfoCache.set(guildId, { data, ts: Date.now() })
      return data
    } catch { return null }
  }

  // Resolve a guild to a proper discord.js Guild object (with channels/members managers)
  // or fall back to raw REST guild info. Stubs from populateGuildCache lack these managers.
  async function resolveGuild(guildId) {
    // 1. Check cache for a proper Guild object (has channels manager AND valid ownerId)
    let guild = discordClient.guilds.cache.get(guildId)
    if (guild && typeof guild.channels?.fetch === 'function' && guild.ownerId) return guild

    // 2. Try discord.js guilds.fetch — force: true to bypass cache stubs from populateGuildCache
    try {
      guild = await discordClient.guilds.fetch({ guild: guildId, force: true })
      if (guild && typeof guild.channels?.fetch === 'function' && guild.ownerId) return guild
    } catch (err) {
      console.warn(`[resolveGuild] guilds.fetch failed for ${guildId}:`, err?.message)
    }

    // 3. Raw REST fallback — returns guild info without discord.js managers
    const info = await getGuildInfoViaREST(guildId)
    if (info) {
      return { id: info.id, name: info.name, ownerId: info.owner_id, icon: info.icon, _restOnly: true }
    }
    return null
  }

  // Fetch a guild member via raw REST (works without gateway)
  async function fetchMemberViaREST(guildId, userId) {
    try {
      return await discordBotAPI(`/guilds/${guildId}/members/${userId}`)
    } catch { return null }
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

  // Resolve the canonical user ID for a session user.
  // Always returns the Discord ID if the account is linked, otherwise google:xxx, otherwise raw id.
  async function resolveCanonicalUserId(user) {
    if (!user) return null
    try {
      if (user.id?.startsWith('google:') && user.google_id) {
        const account = await db.get('SELECT discord_id FROM user_accounts WHERE google_id = ?', [user.google_id])
        if (account?.discord_id) return account.discord_id
      }
      return user.id
    } catch (_) {
      return user.id
    }
  }

  // Migrate preferences from one user_id key to another (e.g. google:xxx → discord snowflake)
  async function migratePreferences(fromUserId, toUserId) {
    if (!fromUserId || !toUserId || fromUserId === toUserId) return
    try {
      const oldPrefs = await db.get('SELECT * FROM user_preferences WHERE user_id = ?', [fromUserId])
      if (!oldPrefs) return
      const existing = await db.get('SELECT * FROM user_preferences WHERE user_id = ?', [toUserId])
      if (!existing) {
        // Move old row to the canonical key
        await db.run('UPDATE user_preferences SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [toUserId, fromUserId])
      } else {
        // Target already has prefs — merge (keep target values, fill gaps from old), then delete old
        const mergedGuild = existing.selected_guild_id || oldPrefs.selected_guild_id
        const mergedPage = existing.selected_page || oldPrefs.selected_page
        const mergedExtra = existing.extra_json || oldPrefs.extra_json
        await db.run('UPDATE user_preferences SET selected_guild_id = ?, selected_page = ?, extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
          [mergedGuild, mergedPage, mergedExtra, toUserId])
        await db.run('DELETE FROM user_preferences WHERE user_id = ?', [fromUserId])
      }
    } catch (_) {}
  }

  // ---- Helper: fetch user guilds via OAuth token, auto-refreshing if expired ----
  async function fetchUserGuildsViaOAuth(discordId) {
    const account = await db.get('SELECT discord_access_token, discord_refresh_token FROM user_accounts WHERE discord_id = ?', [discordId])
    if (!account?.discord_access_token) return null

    // Try the stored access token first
    try {
      const resp = await axios.get('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${account.discord_access_token}` }
      })
      return resp.data
    } catch (err) {
      const status = err?.response?.status
      if (status !== 401) {
        console.warn('[guilds] OAuth token request failed (non-401):', status || err?.message)
        return null
      }
      console.log('[guilds] Access token expired for', discordId, '— attempting refresh')
    }

    // Access token expired — try refresh
    if (!account.discord_refresh_token) {
      console.warn('[guilds] No refresh token stored for', discordId)
      return null
    }
    try {
      const refreshResp = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: account.discord_refresh_token
      }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })
      const newAccess = refreshResp.data.access_token
      const newRefresh = refreshResp.data.refresh_token || account.discord_refresh_token
      if (!newAccess) { console.warn('[guilds] Refresh response had no access_token'); return null }

      // Persist the new tokens
      await db.run(
        'UPDATE user_accounts SET discord_access_token = ?, discord_refresh_token = ? WHERE discord_id = ?',
        [newAccess, newRefresh, discordId]
      )
      console.log('[guilds] Token refreshed successfully for', discordId)

      // Retry guild fetch with new token
      const resp = await axios.get('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${newAccess}` }
      })
      return resp.data
    } catch (refreshErr) {
      console.warn('[guilds] Token refresh failed for', discordId, ':', refreshErr?.response?.status || refreshErr?.message)
      return null
    }
  }

  async function requireGuildOwner(req, res, next) {
    try {
      const guildId = req.params.guildId || req.body.guild_id || req.query.guild_id
      if (!guildId) return res.status(400).json({ error: 'missing_guild_id' })
      const guild = await resolveGuild(guildId)
      if (!guild) return res.status(404).json({ error: 'guild_not_found' })
      const discordId = await resolveCanonicalUserId(req.user)
      if (!discordId) {
        console.warn(`[requireGuildOwner] No discordId resolved for user:`, req.user?.id)
        return res.status(403).json({ error: 'forbidden_not_guild_owner', message: 'Could not determine your Discord identity. Please log in again via Discord OAuth.' })
      }
      // Check ownership (resolveGuild provides ownerId from REST or cache)
      if (guild.ownerId && discordId === guild.ownerId) {
        req.guild = guild
        req.userRole = 'owner'
        return next()
      }
      // Fallback: check via OAuth token (with auto-refresh) — allow owners AND admins
      const userGuilds = await fetchUserGuildsViaOAuth(discordId)
      if (userGuilds) {
        const userGuild = userGuilds.find(g => g.id === guildId)
        if (userGuild) {
          const isOwner = userGuild.owner === true
          const perms = BigInt(userGuild.permissions || 0)
          const isAdmin = (perms & 0x8n) !== 0n || (perms & 0x20n) !== 0n
          if (isOwner || isAdmin) {
            req.guild = guild
            req.userRole = isOwner ? 'owner' : 'admin'
            return next()
          }
        }
        console.warn(`[requireGuildOwner] User ${discordId} lacks owner/admin perms for guild ${guildId}`)
      } else {
        console.warn(`[requireGuildOwner] No OAuth guilds available for user ${discordId} — falling back to REST owner check`)
        // Last-resort: if guild.ownerId was null (cache stub), re-check via direct REST
        if (!guild.ownerId) {
          const info = await getGuildInfoViaREST(guildId)
          if (info && info.owner_id === discordId) {
            req.guild = guild
            req.userRole = 'owner'
            console.log(`[requireGuildOwner] REST owner check confirmed user ${discordId} as owner of guild ${guildId}`)
            return next()
          }
        }
      }
      console.warn(`[requireGuildOwner] DENIED: user=${discordId}, guild=${guildId}, guild.ownerId=${guild.ownerId}`)
      return res.status(403).json({ error: 'forbidden_not_guild_owner', message: 'You must be the server owner or an administrator.' })
    } catch (err) {
      console.error(`[requireGuildOwner] Guild fetch failed:`, err?.message)
      return res.status(404).json({ error: 'guild_not_found' })
    }
  }

  // Owner-only guard — must run AFTER requireGuildOwner (which sets req.userRole)
  function requireStrictOwner(req, res, next) {
    if (req.userRole !== 'owner') {
      return res.status(403).json({ error: 'owner_only', message: 'Only the server owner can perform this action.' })
    }
    next()
  }

  // Like requireGuildOwner but allows any guild member (for read-only endpoints)
  async function requireGuildMember(req, res, next) {
    try {
      const guildId = req.params.guildId || req.body.guild_id || req.query.guild_id
      if (!guildId) return res.status(400).json({ error: 'missing_guild_id' })
      const guild = await resolveGuild(guildId)
      if (!guild) return res.status(404).json({ error: 'guild_not_found' })
      const discordId = await resolveCanonicalUserId(req.user)
      if (!discordId) {
        console.warn(`[requireGuildMember] No discordId resolved for user:`, req.user?.id)
        return res.status(403).json({ error: 'forbidden_no_discord_id' })
      }
      // Owner always passes (resolveGuild provides ownerId)
      if (guild.ownerId && discordId === guild.ownerId) {
        req.guild = guild
        req.userRole = 'owner'
        return next()
      }
      // Check if user is a guild member via bot's guild object
      try {
        if (typeof guild.members?.fetch === 'function') {
          const member = await guild.members.fetch(discordId)
          req.guild = guild
          const hasAdmin = member.permissions.has('Administrator') || member.permissions.has('ManageGuild')
          req.userRole = hasAdmin ? 'admin' : 'member'
          return next()
        }
        throw new Error('No members manager (REST-only fallback)')
      } catch (_) {
        // Fallback: check via user's stored Discord OAuth token (with auto-refresh)
        const userGuilds = await fetchUserGuildsViaOAuth(discordId)
        if (userGuilds) {
          const userGuild = userGuilds.find(g => g.id === guildId)
          if (userGuild) {
            req.guild = guild
            const perms = BigInt(userGuild.permissions || 0)
            req.userRole = userGuild.owner ? 'owner' : ((perms & 0x8n) !== 0n || (perms & 0x20n) !== 0n) ? 'admin' : 'member'
            return next()
          }
        }
        // Last-resort: if guild.ownerId was null (cache stub), re-check via direct REST
        if (!guild.ownerId) {
          const info = await getGuildInfoViaREST(guildId)
          if (info && info.owner_id === discordId) {
            req.guild = guild
            req.userRole = 'owner'
            return next()
          }
        }
        console.warn(`[requireGuildMember] User ${discordId} denied access to guild ${guildId} (owner: ${guild.ownerId})`)
        return res.status(403).json({ error: 'forbidden_not_guild_member' })
      }
    } catch (err) {
      console.error(`[requireGuildMember] Guild fetch failed:`, err?.message)
      return res.status(404).json({ error: 'guild_not_found' })
    }
  }

  // Fetch a text channel and return a wrapper with send/messages.fetch that works in REST-only mode
  async function fetchTextChannel(guildId, channelId) {
    // Only try discord.js if client is fully connected (has gateway session)
    // In REST-only mode (no client.login), discord.js channels.fetch works but
    // channel.send() crashes when constructing the returned Message object
    // because the guild is a stub without proper managers.
    if (discordClient.user) {
      try {
        const channel = await discordClient.channels.fetch(channelId)
        if (channel && 'guildId' in channel && channel.guildId === guildId && 'send' in channel) {
          return channel
        }
      } catch (err) {
        console.warn(`[fetchTextChannel] discord.js fetch failed for ${channelId}:`, err?.message, '— using REST fallback')
      }
    }

    // REST fallback: verify channel belongs to guild, then return wrapper
    console.log(`[fetchTextChannel] Using REST fallback for channel ${channelId}`)
    const channelData = await discordBotAPI(`/channels/${channelId}`)
    console.log(`[fetchTextChannel] REST channel data: id=${channelData?.id}, guild_id=${channelData?.guild_id}, type=${channelData?.type}`)
    if (!channelData || channelData.guild_id !== guildId) throw new Error('invalid_channel')
    if (channelData.type !== 0 && channelData.type !== 5) throw new Error('not_text_channel')

    // Return a channel-like wrapper using raw REST
    return {
      id: channelData.id,
      guildId: channelData.guild_id,
      name: channelData.name,
      type: channelData.type,
      _restOnly: true,

      // Send a message via raw REST
      async send(payload) {
        // Convert discord.js Embed/ActionRow objects to JSON
        const body = {}
        if (typeof payload === 'string') {
          body.content = payload
        } else {
          if (payload.content) body.content = payload.content
          if (payload.embeds) body.embeds = payload.embeds.map(e => typeof e.toJSON === 'function' ? e.toJSON() : e)
          if (payload.components) body.components = payload.components.map(c => typeof c.toJSON === 'function' ? c.toJSON() : c)
        }

        // Handle file uploads (Node 20 has native FormData & Blob)
        if (payload.files && payload.files.length > 0) {
          const form = new FormData()
          form.append('payload_json', JSON.stringify(body))
          for (let i = 0; i < payload.files.length; i++) {
            const f = payload.files[i]
            const blob = new Blob([f.attachment], { type: 'application/octet-stream' })
            form.append(`files[${i}]`, blob, f.name || 'file')
          }
          return await discordBotUpload(`/channels/${channelData.id}/messages`, form)
        }

        return await discordBotRequest('POST', `/channels/${channelData.id}/messages`, body)
      },

      // Messages sub-object for fetch/delete
      messages: {
        async fetch(opts) {
          if (typeof opts === 'string') {
            // Fetch single message by ID
            return await discordBotAPI(`/channels/${channelData.id}/messages/${opts}`)
          }
          // Fetch multiple messages
          const limit = opts?.limit || 50
          const msgs = await discordBotAPI(`/channels/${channelData.id}/messages?limit=${limit}`)
          // Return as a Map-like iterable
          const map = new Map()
          for (const m of msgs) {
            m.attachments = new Map((m.attachments || []).map(a => [a.id, a]))
            m.embeds = m.embeds || []
            m.author = m.author || {}
            m.createdAt = m.timestamp ? new Date(m.timestamp) : new Date()
            map.set(m.id, m)
          }
          return map
        }
      }
    }
  }

  // Serve a minimal favicon to avoid 404
  app.get('/favicon.ico', (req, res) => res.status(204).end())

  const BACKEND_BUILD_TS = new Date().toISOString()
  app.get('/api/health', (req, res) => res.json({ ok: true, build: BACKEND_BUILD_TS, mode: discordClient.user ? 'gateway' : 'rest-only' }))

  // Diagnostics: check if Discord Interactions Endpoint URL is set
  // If set, Discord sends interactions via HTTP instead of gateway — bot never receives them
  app.get('/api/diagnostics', async (req, res) => {
    try {
      const appInfo = await discordBotAPI('/applications/@me')
      res.json({
        build: BACKEND_BUILD_TS,
        mode: discordClient.user ? 'gateway' : 'rest-only',
        interactions_endpoint_url: appInfo?.interactions_endpoint_url || null,
        interactions_endpoint_set: !!appInfo?.interactions_endpoint_url,
        app_id: appInfo?.id,
        app_name: appInfo?.name,
        bot_connected: !!discordClient.user,
        warning: appInfo?.interactions_endpoint_url
          ? 'CRITICAL: Interactions Endpoint URL is set! Discord sends all button clicks to this URL instead of the bot gateway. The bot never receives interactions. Remove this URL from Discord Developer Portal > General Information.'
          : null
      })
    } catch (err) {
      res.status(500).json({ error: err?.message })
    }
  })

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
    const diag = []                      // diagnostic breadcrumbs
    const ok  = (step) => diag.push({ step, ok: true })
    const fail = (step, detail) => { diag.push({ step, ok: false, detail: String(detail).slice(0, 400) }) }

    // ---- helper: render a styled HTML diagnostic page ----
    const renderDiagPage = (status, headline) => {
      const rows = diag.map(d =>
        `<tr><td style="padding:6px 12px">${d.ok ? '✅' : '❌'} ${d.step}</td><td style="padding:6px 12px;color:${d.ok ? '#4ade80' : '#f87171'}">${d.detail || 'OK'}</td></tr>`
      ).join('')
      res.status(status).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>DCB OAuth Diagnostic</title>
<style>body{background:#111;color:#e5e5e5;font-family:system-ui,sans-serif;padding:40px;max-width:800px;margin:auto}
h1{color:#f87171}table{border-collapse:collapse;width:100%;margin-top:24px}tr:nth-child(even){background:#1a1a2e}
td{border:1px solid #333}.info{margin-top:20px;padding:12px;background:#1e293b;border-radius:8px;word-break:break-all;font-size:13px}</style></head>
<body><h1>${headline}</h1><table><tr><th style="padding:6px 12px;text-align:left">Step</th><th style="padding:6px 12px;text-align:left">Result</th></tr>${rows}</table>
<div class="info"><b>Callback URI used:</b> ${diag._callbackUri || 'N/A'}<br><b>Has code:</b> ${!!req.query.code}<br><b>State match:</b> ${req.query.state === req.cookies?.dcb_oauth_state}<br>
<b>DB_PATH:</b> ${process.env.DCB_DB_PATH || '(default)'}<br><b>UI_BASE:</b> ${uiBase || '(none)'}<br><b>Time:</b> ${new Date().toISOString()}</div></body></html>`)
    }

    const { code, state } = req.query
    const savedState = req.cookies?.dcb_oauth_state

    console.log('[OAuth Discord] callback hit, state match:', state === savedState, 'has code:', !!code)

    if (!code) { fail('params', 'Missing code query param'); return renderDiagPage(400, 'OAuth Error — Missing code') }
    if (!state || !savedState || state !== savedState) {
      fail('state', `saved=${savedState} received=${state}`)
      console.error('[OAuth Discord] state mismatch — saved:', savedState, 'received:', state)
      return renderDiagPage(400, 'OAuth Error — State mismatch')
    }
    ok('state')

    const clientId = process.env.DISCORD_CLIENT_ID
    const clientSecret = process.env.DISCORD_CLIENT_SECRET
    if (!clientId || !clientSecret) { fail('config', 'DISCORD_CLIENT_ID or SECRET missing'); return renderDiagPage(500, 'OAuth Error — Not configured') }
    ok('config')

    const callbackUri = `${baseUrl(req)}/auth/discord/callback`
    diag._callbackUri = callbackUri
    console.log('[OAuth Discord] token exchange redirect_uri:', callbackUri)

    try {
      // Step 1: Exchange code for token
      let tokenResp
      try {
        tokenResp = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: callbackUri
        }).toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
        ok('token_exchange')
      } catch (tokenErr) {
        const detail = tokenErr?.response?.data || tokenErr?.message || tokenErr
        console.error('[OAuth Discord] token exchange failed:', detail)
        fail('token_exchange', JSON.stringify(detail))
        return renderDiagPage(502, 'OAuth Error — Token exchange failed')
      }

      // Step 2: Fetch user info
      const accessToken = tokenResp.data.access_token
      if (!accessToken) {
        console.error('[OAuth Discord] no access_token in response:', tokenResp.data)
        fail('access_token', 'No access_token in Discord response: ' + JSON.stringify(tokenResp.data))
        return renderDiagPage(502, 'OAuth Error — No access token')
      }
      ok('access_token')

      let userResp
      try {
        userResp = await axios.get('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
        ok('user_fetch')
      } catch (userErr) {
        console.error('[OAuth Discord] user fetch failed:', userErr?.response?.data || userErr?.message)
        fail('user_fetch', JSON.stringify(userErr?.response?.data || userErr?.message))
        return renderDiagPage(502, 'OAuth Error — User fetch failed')
      }

      const discordId = userResp.data.id
      console.log('[OAuth Discord] user fetched:', discordId, userResp.data.username)

      // Step 3: Upsert user_accounts row (including access + refresh token for guild listing)
      const refreshToken = tokenResp.data.refresh_token || null
      try {
        await db.run(
          `INSERT INTO user_accounts (discord_id, discord_access_token, discord_refresh_token, last_login_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(discord_id) DO UPDATE SET discord_access_token = ?, discord_refresh_token = COALESCE(?, discord_refresh_token), last_login_at = CURRENT_TIMESTAMP`,
          [discordId, accessToken, refreshToken, accessToken, refreshToken]
        )
        ok('db_upsert')
      } catch (dbErr) {
        console.error('[OAuth Discord] db upsert failed:', dbErr?.message || dbErr)
        fail('db_upsert', dbErr?.message || String(dbErr))
        return renderDiagPage(500, 'OAuth Error — Database error')
      }

      // Step 4: Check linked Google account
      let linkedAccount = null
      try {
        linkedAccount = await db.get('SELECT google_id, google_email, google_picture FROM user_accounts WHERE discord_id = ?', [discordId])
        ok('linked_check')
      } catch (e) {
        fail('linked_check', e?.message)
      }

      // If linking a Google-first user to this Discord account
      const linkingGoogleId = req.cookies?.dcb_linking_google_id
      if (linkingGoogleId) {
        try {
          const googleAccount = await db.get('SELECT * FROM user_accounts WHERE google_id = ?', [linkingGoogleId])
          if (googleAccount) {
            if (!googleAccount.discord_id) {
              await db.run('UPDATE user_accounts SET google_id = ?, google_email = ?, google_name = ?, google_picture = ?, last_login_at = CURRENT_TIMESTAMP WHERE discord_id = ?',
                [linkingGoogleId, googleAccount.google_email, googleAccount.google_name, googleAccount.google_picture, discordId])
              await db.run('DELETE FROM user_accounts WHERE id = ? AND discord_id IS NULL', [googleAccount.id])
            } else if (googleAccount.discord_id === discordId) {
              await db.run('UPDATE user_accounts SET last_login_at = CURRENT_TIMESTAMP WHERE discord_id = ?', [discordId])
            }
            await migratePreferences(`google:${linkingGoogleId}`, discordId)
          }
          ok('account_link')
        } catch (linkErr) {
          console.error('[OAuth Discord] account linking error (non-fatal):', linkErr?.message)
          fail('account_link', linkErr?.message)
        }
        res.clearCookie('dcb_linking_google_id')
        try {
          linkedAccount = await db.get('SELECT google_id, google_email, google_picture FROM user_accounts WHERE discord_id = ?', [discordId])
        } catch (_) {}
      }

      // Migrate orphaned google preferences
      if (linkedAccount?.google_id) {
        await migratePreferences(`google:${linkedAccount.google_id}`, discordId).catch(() => {})
      }

      // Step 5: Build JWT
      if (!sessionSecret) {
        console.error('[OAuth Discord] DCB_SESSION_SECRET is not set!')
        fail('jwt', 'DCB_SESSION_SECRET is empty/null')
        return renderDiagPage(500, 'OAuth Error — Session secret missing')
      }

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

      const jwtToken = jwt.sign(payload, sessionSecret, { expiresIn: 60 * 60 * 24 * 30 })
      ok('jwt')

      res.cookie('dcb_session', jwtToken, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
        maxAge: 60 * 60 * 24 * 30 * 1000
      })

      res.clearCookie('dcb_oauth_state')

      console.log('[OAuth Discord] login success for', userResp.data.username, '— redirecting')

      if (uiBase) {
        const u = new URL(uiBase)
        u.searchParams.set('dcb_token', jwtToken)
        return res.redirect(u.toString())
      }
      return res.json({ ok: true })
    } catch (err) {
      console.error('[OAuth Discord] unexpected callback error:', err?.stack || err?.message || err)
      fail('unexpected', (err?.stack || err?.message || String(err)))
      return renderDiagPage(500, 'OAuth Error — Unexpected failure')
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
          // Migrate preferences from google:xxx to the Discord ID
          await migratePreferences(`google:${googleId}`, linkingDiscordId)
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

  // Start linking Discord to an existing Google-only session
  app.get('/auth/discord/link', requireAuth, (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID
    if (!clientId) return res.status(500).send('DISCORD_CLIENT_ID not configured')
    if (!req.user.google_id) return res.status(400).send('Not a Google session — log in with Google first')

    // Remember the Google user we're linking
    res.cookie('dcb_linking_google_id', req.user.google_id, { httpOnly: true, sameSite: cookieSameSite, secure: cookieSecure, maxAge: 600_000 })

    // Clear existing session before starting a new OAuth flow
    clearSessionCookie(res)

    const state = crypto.randomBytes(12).toString('hex')
    res.cookie('dcb_oauth_state', state, { httpOnly: true, sameSite: cookieSameSite, secure: cookieSecure })

    const redirectUri = encodeURIComponent(`${baseUrl(req)}/auth/discord/callback`)
    const scope = encodeURIComponent('identify email guilds')
    const url = `https://discord.com/api/oauth2/authorize?response_type=code&client_id=${clientId}&scope=${scope}&redirect_uri=${redirectUri}&prompt=consent&state=${state}`
    return res.redirect(url)
  })

  // ---- User Preferences (persist selections across sessions) ----
  // Preferences always use the canonical user ID so they survive provider switches.
  app.get('/api/user/preferences', requireAuth, async (req, res) => {
    try {
      const canonicalId = await resolveCanonicalUserId(req.user)
      let prefs = await db.get('SELECT * FROM user_preferences WHERE user_id = ?', [canonicalId])

      // Fallback: check under the raw session id (un-migrated data)
      if (!prefs && canonicalId !== req.user.id) {
        prefs = await db.get('SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id])
        if (prefs) {
          // Auto-migrate to canonical key
          await migratePreferences(req.user.id, canonicalId)
        }
      }

      res.json(prefs || { selected_guild_id: null, selected_page: 'dashboard' })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_preferences' })
    }
  })

  app.put('/api/user/preferences', requireAuth, async (req, res) => {
    try {
      const canonicalId = await resolveCanonicalUserId(req.user)
      const { selected_guild_id, selected_page, extra_json } = req.body || {}
      await db.run(
        `INSERT INTO user_preferences (user_id, selected_guild_id, selected_page, extra_json, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           selected_guild_id = COALESCE(excluded.selected_guild_id, user_preferences.selected_guild_id),
           selected_page = COALESCE(excluded.selected_page, user_preferences.selected_page),
           extra_json = COALESCE(excluded.extra_json, user_preferences.extra_json),
           updated_at = CURRENT_TIMESTAMP`,
        [canonicalId, selected_guild_id || null, selected_page || 'dashboard', extra_json ? JSON.stringify(extra_json) : null]
      )
      // Clean up any orphaned prefs under old keys
      if (canonicalId !== req.user.id) {
        await db.run('DELETE FROM user_preferences WHERE user_id = ?', [req.user.id]).catch(() => {})
      }
      const prefs = await db.get('SELECT * FROM user_preferences WHERE user_id = ?', [canonicalId])
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
    const discordId = await resolveCanonicalUserId(req.user)
    const results = []
    const botGuildIds = new Set(discordClient.guilds.cache.map(g => g.id))

    // Try to use the user's Discord OAuth token to get THEIR guild list
    // This is more reliable than depending on the bot's member cache
    let userGuilds = null
    if (discordId) {
      userGuilds = await fetchUserGuildsViaOAuth(discordId)
    }

    if (userGuilds) {
      // Use the user's own guild list, filtered to guilds where the bot is also present
      for (const ug of userGuilds) {
        if (botGuildIds.has(ug.id)) {
          const isOwner = ug.owner === true
          // Check if user has MANAGE_GUILD (0x20) or ADMINISTRATOR (0x8) permission
          const perms = BigInt(ug.permissions || 0)
          const isAdmin = (perms & 0x8n) !== 0n || (perms & 0x20n) !== 0n
          let role = isOwner ? 'owner' : isAdmin ? 'admin' : 'member'
          // Double-check: if not detected as owner via OAuth, verify via REST guild info
          // (handles edge cases where Discord OAuth returns owner: false incorrectly)
          if (role !== 'owner' && discordId) {
            try {
              const guildInfo = await getGuildInfoViaREST(ug.id)
              if (guildInfo && guildInfo.owner_id === discordId) {
                role = 'owner'
              }
            } catch (_) {}
          }
          results.push({
            id: ug.id,
            name: ug.name,
            role
          })
        }
      }
    } else {
      // Fallback: use raw REST to check each guild (when OAuth token unavailable)
      for (const g of discordClient.guilds.cache.values()) {
        try {
          const guildInfo = await getGuildInfoViaREST(g.id)
          if (!guildInfo) continue
          if (guildInfo.owner_id === discordId) {
            results.push({ id: g.id, name: guildInfo.name || g.name, role: 'owner' })
          } else if (discordId) {
            const member = await fetchMemberViaREST(g.id, discordId)
            if (member) {
              // Check member permissions via their roles
              const memberPerms = BigInt(member.permissions || 0)
              const hasAdmin = (memberPerms & 0x8n) !== 0n || (memberPerms & 0x20n) !== 0n
              results.push({ id: g.id, name: guildInfo.name || g.name, role: hasAdmin ? 'admin' : 'member' })
            }
          }
        } catch (_) {
        }
      }
    }
    res.json(results)
  })

  app.get('/api/admin/guilds/:guildId/channels', requireAuth, requireGuildMember, async (req, res) => {
    try {
      let out = []
      if (typeof req.guild.channels?.fetch === 'function') {
        // Proper discord.js Guild — use channels manager
        const channels = await req.guild.channels.fetch()
        for (const c of channels.values()) {
          if (c && (c.type === 0 || c.type === 5)) out.push({ id: c.id, name: c.name, type: c.type })
        }
      } else {
        // REST-only fallback — fetch channels via raw REST
        const channels = await discordBotAPI(`/guilds/${req.params.guildId}/channels`)
        for (const c of channels) {
          if (c.type === 0 || c.type === 5) out.push({ id: c.id, name: c.name, type: c.type })
        }
      }
      out.sort((a, b) => a.name.localeCompare(b.name))
      res.json(out)
    } catch (err) {
      console.error('[channels] Fetch error:', err?.message)
      res.status(500).json({ error: 'channel_fetch_failed' })
    }
  })

  app.get('/api/admin/guilds/:guildId/tasks', requireAuth, requireGuildMember, async (req, res) => {
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

  app.get('/api/admin/guilds/:guildId/contests', requireAuth, requireGuildMember, async (req, res) => {
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

  app.get('/api/admin/guilds/:guildId/bulk-tasks', requireAuth, requireGuildMember, async (req, res) => {
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

  // ---- Discord Channel Media (images previously posted) ----
  app.get('/api/admin/guilds/:guildId/channels/:channelId/media', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const channel = await fetchTextChannel(req.guild.id, req.params.channelId)
      const limit = Math.min(Number(req.query.limit) || 50, 100)
      const messages = await channel.messages.fetch({ limit })
      const media = []
      for (const msg of messages.values()) {
        for (const att of msg.attachments.values()) {
          if (att.contentType && att.contentType.startsWith('image/')) {
            media.push({
              id: att.id,
              url: att.url,
              proxyURL: att.proxyURL,
              name: att.name,
              width: att.width,
              height: att.height,
              messageId: msg.id,
              authorTag: msg.author?.tag || 'Unknown',
              postedAt: msg.createdAt?.toISOString(),
            })
          }
        }
        // Also pick up image embeds
        for (const embed of msg.embeds) {
          if (embed.image?.url) {
            media.push({
              id: `embed-${msg.id}-${media.length}`,
              url: embed.image.url,
              proxyURL: embed.image.proxyURL || embed.image.url,
              name: 'Embedded image',
              width: embed.image.width,
              height: embed.image.height,
              messageId: msg.id,
              authorTag: msg.author?.tag || 'Unknown',
              postedAt: msg.createdAt?.toISOString(),
            })
          }
        }
      }
      res.json(media)
    } catch (err) {
      console.error('[media] fetch error:', err?.message || err)
      res.status(500).json({ error: 'failed_to_fetch_media' })
    }
  })

  // ---- Upload image to a Discord channel (returns attachment URL) ----
  app.post('/api/admin/guilds/:guildId/channels/:channelId/upload', requireAuth, requireGuildOwner, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'no_file' })
      const channel = await fetchTextChannel(req.guild.id, req.params.channelId)
      const msg = await channel.send({
        content: req.body.caption || '📸 Event image upload',
        files: [{ attachment: req.file.buffer, name: req.file.originalname || 'image.png' }],
      })
      const att = msg.attachments.first()
      res.json({
        id: att.id,
        url: att.url,
        proxyURL: att.proxyURL,
        name: att.name,
        messageId: msg.id,
      })
    } catch (err) {
      console.error('[upload] error:', err?.message || err)
      res.status(500).json({ error: 'upload_failed' })
    }
  })

  app.get('/api/admin/guilds/:guildId/vote-events/history', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const gid = req.guild.id
      const events = await db.all(
        `SELECT ve.*,
          (SELECT COUNT(*) FROM vote_event_participants WHERE vote_event_id = ve.id) AS total_participants,
          (SELECT COUNT(*) FROM vote_event_participants WHERE vote_event_id = ve.id AND voted_image_id IS NOT NULL) AS total_votes,
          (SELECT COUNT(*) FROM vote_event_participants WHERE vote_event_id = ve.id AND is_winner = 1) AS total_winners
        FROM vote_events ve
        WHERE ve.guild_id = ? AND (
          ve.status IN ('ended','completed','cancelled')
          OR (ve.ends_at IS NOT NULL AND ve.ends_at <= datetime('now'))
        )
        ORDER BY ve.created_at DESC LIMIT 50`,
        [gid]
      )
      // Also grab aggregate stats
      const agg = await db.get(
        `SELECT
          COUNT(*) AS total_events,
          SUM(CASE WHEN status IN ('ended','completed') OR (ends_at IS NOT NULL AND ends_at <= datetime('now') AND status != 'cancelled') THEN 1 ELSE 0 END) AS completed_events,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_events,
          SUM(CASE WHEN status IN ('ended','completed') OR (ends_at IS NOT NULL AND ends_at <= datetime('now') AND status != 'cancelled') THEN prize_amount ELSE 0 END) AS total_prize_paid,
          SUM(current_participants) AS total_participants_all
        FROM vote_events WHERE guild_id = ? AND (
          status IN ('ended','completed','cancelled')
          OR (ends_at IS NOT NULL AND ends_at <= datetime('now'))
        )`,
        [gid]
      )
      res.json({ events, stats: agg || {} })
    } catch (err) {
      console.error('[vote-events] history error:', err?.message || err)
      res.status(500).json({ error: 'history_failed' })
    }
  })

  // ---- Combined ticker: vote events + horse race events (all statuses) ----
  app.get('/api/admin/guilds/:guildId/ticker', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const gid = req.guild.id

      // Vote events (all statuses)
      const voteEvents = await db.all(
        `SELECT ve.id, ve.title, ve.status, ve.prize_amount, ve.currency,
          ve.current_participants, ve.created_at, ve.ends_at,
          (SELECT COUNT(*) FROM vote_event_participants WHERE vote_event_id = ve.id) AS total_participants,
          (SELECT COUNT(*) FROM vote_event_participants WHERE vote_event_id = ve.id AND voted_image_id IS NOT NULL) AS total_votes,
          (SELECT COUNT(*) FROM vote_event_participants WHERE vote_event_id = ve.id AND is_winner = 1) AS total_winners
        FROM vote_events ve
        WHERE ve.guild_id = ?
        ORDER BY ve.created_at DESC LIMIT 25`,
        [gid]
      )

      // Horse race / gambling events (all statuses)
      let gamblingEvents = []
      try {
        gamblingEvents = await db.all(
          `SELECT ge.id, ge.title, ge.status, ge.prize_amount, ge.currency,
            ge.current_players, ge.min_players, ge.max_players,
            ge.winning_slot, ge.mode, ge.entry_fee,
            ge.created_at, ge.ends_at
          FROM gambling_events ge
          WHERE ge.guild_id = ?
          ORDER BY ge.created_at DESC LIMIT 25`,
          [gid]
        )
      } catch (_) { /* table may not exist */ }

      // Merge into unified ticker items
      const items = []
      for (const ve of voteEvents) {
        items.push({
          id: ve.id,
          type: 'vote',
          title: ve.title,
          status: ve.status === 'active' && ve.ends_at && new Date(ve.ends_at) <= new Date() ? 'ended' : ve.status,
          prize_amount: ve.prize_amount || 0,
          currency: ve.currency || 'SOL',
          participants: ve.total_participants || ve.current_participants || 0,
          detail: `🗳️ ${ve.total_votes || 0} votes`,
          winners: ve.total_winners || 0,
          created_at: ve.created_at,
          ends_at: ve.ends_at,
        })
      }
      for (const ge of gamblingEvents) {
        const isEnded = ge.status === 'ended' || ge.status === 'completed' || ge.winning_slot;
        items.push({
          id: ge.id,
          type: 'race',
          title: ge.title,
          status: isEnded ? 'ended' : ge.status,
          prize_amount: ge.mode === 'pot' ? (ge.entry_fee * ge.current_players * 0.9) : (ge.prize_amount || 0),
          currency: ge.currency || 'SOL',
          participants: ge.current_players || 0,
          detail: `🏇 ${ge.current_players || 0}/${ge.max_players} riders`,
          winners: ge.winning_slot ? 1 : 0,
          created_at: ge.created_at,
          ends_at: ge.ends_at,
        })
      }

      // Sort by created_at descending
      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      // Aggregate stats
      const stats = {
        total_events: items.length,
        completed_events: items.filter(i => i.status === 'ended' || i.status === 'completed').length,
        active_events: items.filter(i => i.status === 'active').length,
        cancelled_events: items.filter(i => i.status === 'cancelled').length,
        total_prize_paid: items.filter(i => i.status === 'ended' || i.status === 'completed').reduce((s, i) => s + (i.prize_amount || 0), 0),
        total_participants: items.reduce((s, i) => s + (i.participants || 0), 0),
      }

      res.json({ items: items.slice(0, 50), stats })
    } catch (err) {
      console.error('[ticker] error:', err?.message || err)
      res.status(500).json({ error: 'ticker_failed' })
    }
  })

  app.get('/api/admin/guilds/:guildId/vote-events', requireAuth, requireGuildMember, async (req, res) => {
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
      qualification_url,
    } = req.body || {}

    if (!channel_id || !title || !description) return res.status(400).json({ error: 'missing_fields' })
    if (!min_participants || !max_participants) return res.status(400).json({ error: 'missing_participant_limits' })
    if (!Array.isArray(images) || images.length < 2) return res.status(400).json({ error: 'at_least_two_images_required' })

    const endsAt = duration_minutes ? new Date(Date.now() + (Number(duration_minutes) * 60 * 1000)).toISOString() : null

    const r = await db.run(
      `INSERT INTO vote_events (guild_id, channel_id, title, description, prize_amount, currency, min_participants, max_participants, duration_minutes, owner_favorite_image_id, created_by, ends_at, qualification_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        qualification_url || null,
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

    // Track event creation for worker stats
    const canonicalId = await resolveCanonicalUserId(req.user)
    if (canonicalId) {
      const worker = await db.get('SELECT * FROM dcb_workers WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL', [req.guild.id, canonicalId])
      if (worker) {
        const today = new Date().toISOString().slice(0, 10)
        await db.run('INSERT INTO worker_activity (guild_id, discord_id, action_type, detail, channel_id) VALUES (?, ?, ?, ?, ?)',
          [req.guild.id, canonicalId, 'event_created', `Created vote event: ${title}`, String(channel_id)]).catch(() => {})
        await db.run(
          `INSERT INTO worker_daily_stats (guild_id, discord_id, stat_date, events_created) VALUES (?, ?, ?, 1)
           ON CONFLICT(guild_id, discord_id, stat_date) DO UPDATE SET events_created = events_created + 1`,
          [req.guild.id, canonicalId, today]).catch(() => {})
      }
    }

    res.json(event)
  })

  app.post('/api/admin/guilds/:guildId/vote-events/:eventId/publish', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT * FROM vote_events WHERE id = ?', [eventId])
      if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'vote_event_not_found' })

      const channelId = req.body?.channel_id || event.channel_id
      const channel = await fetchTextChannel(req.guild.id, channelId)
      const images = await db.all('SELECT * FROM vote_event_images WHERE vote_event_id = ? ORDER BY upload_order ASC', [eventId])

      // Recalculate ends_at from NOW so the timer starts at publish time, not creation time
      let endTimestamp = null
      if (event.duration_minutes) {
        const newEndsAt = new Date(Date.now() + event.duration_minutes * 60 * 1000).toISOString()
        await db.run('UPDATE vote_events SET ends_at = ? WHERE id = ?', [newEndsAt, eventId])
        event.ends_at = newEndsAt
        endTimestamp = Math.floor(new Date(newEndsAt).getTime() / 1000)
      } else if (event.ends_at) {
        endTimestamp = Math.floor(new Date(event.ends_at).getTime() / 1000)
      }

      // ---- Build rich multi-embed interactive post ----
      const hasQualUrl = !!event.qualification_url
      const embeds = []

      // Main event card
      const howItWorks = hasQualUrl
        ? '**How it works:**\n' +
          '1️⃣ Click **✅ Qualify** — opens the task URL\n' +
          '2️⃣ Upload a screenshot proving you visited\n' +
          '3️⃣ Click **🎫 Join Event** to claim your seat\n' +
          '4️⃣ Voting opens once **minimum participants** join\n' +
          '5️⃣ Vote for your favorite image — winners get paid instantly! 💰'
        : '**How it works:**\n' +
          '1️⃣ Click **🎫 Join Event** to claim a seat\n' +
          '2️⃣ Voting opens once **minimum participants** join\n' +
          '3️⃣ Vote for your favorite image\n' +
          '4️⃣ Winners who match the owner\'s pick get paid instantly! 💰'

      const mainEmbed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle(`🗳️ DCB Vote Event: ${event.title}`)
        .setDescription(
          (event.description || 'Vote for your favorite image!') +
          '\n\n' + howItWorks
        )
        .addFields(
          { name: '🪑 Seats', value: `${event.current_participants}/${event.max_participants}`, inline: true },
          { name: '✅ Min to Start', value: `${event.min_participants}`, inline: true },
          { name: '🎁 Prize Pool', value: `${Number(event.prize_amount || 0)} ${event.currency}`, inline: true },
        )
        .setFooter({ text: `DisCryptoBank • Event #${eventId} • Provably Fair` })
        .setTimestamp()

      if (hasQualUrl) mainEmbed.addFields({ name: '🔗 Qualification URL', value: `[Visit this link](${event.qualification_url})`, inline: true })
      if (endTimestamp) mainEmbed.addFields({ name: '⏱️ Ends', value: `<t:${endTimestamp}:R>`, inline: true })
      embeds.push(mainEmbed)

      // Per-image embeds (up to 5 images, each with its own thumbnail)
      for (const img of images.slice(0, 5)) {
        const imgEmbed = new EmbedBuilder()
          .setColor(img.upload_order === 1 ? '#E74C3C' : img.upload_order === 2 ? '#3498DB' : img.upload_order === 3 ? '#2ECC71' : img.upload_order === 4 ? '#F39C12' : '#9B59B6')
          .setTitle(`📷 Image ${img.upload_order}`)
          .setImage(img.image_url)
          .setFooter({ text: `Image ID: ${img.image_id}` })
        embeds.push(imgEmbed)
      }

      // ---- Build components: Qualify (if needed) + Join + per-image Vote buttons ----
      const components = []

      // Row 1: Qualify + Join Event buttons
      const topButtons = []
      if (hasQualUrl) {
        topButtons.push(
          new ButtonBuilder()
            .setCustomId(`vote_event_qualify_${eventId}`)
            .setLabel('✅ Qualify')
            .setStyle(ButtonStyle.Primary)
        )
      }
      topButtons.push(
        new ButtonBuilder()
          .setCustomId(`vote_event_join_${eventId}`)
          .setLabel('🎫 Join Event')
          .setStyle(ButtonStyle.Success)
      )
      components.push(new ActionRowBuilder().addComponents(...topButtons))

      // Row 2+: Vote buttons (up to 5 per row, max 5 action rows total incl. join row)
      const voteButtons = images.slice(0, 4).map((img, idx) => {
        const styles = [ButtonStyle.Danger, ButtonStyle.Primary, ButtonStyle.Success, ButtonStyle.Secondary]
        return new ButtonBuilder()
          .setCustomId(`vote_event_imgvote_${eventId}_${img.image_id}`)
          .setLabel(`Vote Image ${img.upload_order}`)
          .setStyle(styles[idx % styles.length])
      })

      if (voteButtons.length > 0) {
        components.push(new ActionRowBuilder().addComponents(...voteButtons))
      }

      // Row 3: Select menu (still supported for accessibility)
      if (images.length > 0) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`vote_event_vote_${eventId}`)
          .setPlaceholder('Or use this dropdown to vote')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            images.map(img => new StringSelectMenuOptionBuilder()
              .setLabel(`Image ${img.upload_order}`)
              .setValue(img.image_id)
              .setDescription(`Vote for Image ${img.upload_order}`)
            )
          )
        components.push(new ActionRowBuilder().addComponents(selectMenu))
      }

      const msg = await channel.send({ embeds, components })

      await db.run('UPDATE vote_events SET message_id = ?, channel_id = ? WHERE id = ?', [msg.id, String(channelId), eventId])

      res.json({ ok: true, message_id: msg.id, channel_id: String(channelId) })
    } catch (err) {
      console.error('[vote-events] publish error:', err?.message || err)
      res.status(500).json({ error: 'publish_failed', detail: err?.message })
    }
  })

  // ---- Vote Event Delete ----
  app.delete('/api/admin/guilds/:guildId/vote-events/:eventId', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT * FROM vote_events WHERE id = ?', [eventId])
      if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'vote_event_not_found' })

      // Delete the Discord message if one was published
      if (event.message_id && event.channel_id) {
        try {
          await discordBotRequest('DELETE', `/channels/${event.channel_id}/messages/${event.message_id}`)
        } catch (discordErr) {
          console.warn(`[vote-events] Could not delete Discord message for event #${eventId}:`, discordErr?.message || discordErr)
        }
      }

      await db.run('DELETE FROM vote_event_qualifications WHERE vote_event_id = ?', [eventId])
      await db.run('DELETE FROM vote_event_images WHERE vote_event_id = ?', [eventId])
      await db.run('DELETE FROM vote_events WHERE id = ?', [eventId])
      res.json({ ok: true })
    } catch (err) {
      console.error('[vote-events] delete error:', err?.message || err)
      res.status(500).json({ error: 'delete_failed' })
    }
  })

  // ---- Vote Event Cancel ----
  app.patch('/api/admin/guilds/:guildId/vote-events/:eventId/cancel', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT * FROM vote_events WHERE id = ?', [eventId])
      if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'vote_event_not_found' })

      // Delete the Discord message if one was published
      if (event.message_id && event.channel_id) {
        try {
          await discordBotRequest('DELETE', `/channels/${event.channel_id}/messages/${event.message_id}`)
        } catch (discordErr) {
          console.warn(`[vote-events] Could not delete Discord message for cancelled event #${eventId}:`, discordErr?.message || discordErr)
        }
      }

      await db.run('UPDATE vote_events SET status = ? WHERE id = ?', ['cancelled', eventId])
      res.json({ ok: true })
    } catch (err) {
      console.error('[vote-events] cancel error:', err?.message || err)
      res.status(500).json({ error: 'cancel_failed' })
    }
  })

  // ---- Vote Event Qualifications (Admin) ----
  app.get('/api/admin/guilds/:guildId/vote-events/:eventId/qualifications', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT * FROM vote_events WHERE id = ?', [eventId])
      if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'vote_event_not_found' })
      const rows = await db.all('SELECT * FROM vote_event_qualifications WHERE vote_event_id = ? ORDER BY submitted_at DESC', [eventId])
      res.json(rows)
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_qualifications' })
    }
  })

  app.patch('/api/admin/guilds/:guildId/qualifications/:qualId/review', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const qualId = Number(req.params.qualId)
      const { status } = req.body || {}
      if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'invalid_status' })
      const qual = await db.get('SELECT q.*, e.guild_id FROM vote_event_qualifications q JOIN vote_events e ON q.vote_event_id = e.id WHERE q.id = ?', [qualId])
      if (!qual || qual.guild_id !== req.guild.id) return res.status(404).json({ error: 'qualification_not_found' })
      const reviewerId = await resolveCanonicalUserId(req.user)
      await db.run('UPDATE vote_event_qualifications SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?',
        [status, reviewerId || req.user.id, qualId])
      const updated = await db.get('SELECT * FROM vote_event_qualifications WHERE id = ?', [qualId])
      res.json(updated)
    } catch (err) {
      res.status(500).json({ error: 'review_failed' })
    }
  })

  // ---- Vote Event Qualifications (Public / Participant) ----
  // Get event info for qualification — any authenticated user
  app.get('/api/public/vote-events/:eventId', requireAuth, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT id, title, description, prize_amount, currency, min_participants, max_participants, current_participants, status, qualification_url, ends_at, created_at FROM vote_events WHERE id = ?', [eventId])
      if (!event) return res.status(404).json({ error: 'not_found' })
      const images = await db.all('SELECT image_id, image_url, upload_order FROM vote_event_images WHERE vote_event_id = ? ORDER BY upload_order ASC', [eventId])
      res.json({ ...event, images })
    } catch (err) {
      res.status(500).json({ error: 'failed' })
    }
  })

  // Check own qualification status
  app.get('/api/public/vote-events/:eventId/my-qualification', requireAuth, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const userId = await resolveCanonicalUserId(req.user)
      const qual = await db.get('SELECT * FROM vote_event_qualifications WHERE vote_event_id = ? AND user_id = ?', [eventId, userId || req.user.id])
      res.json(qual || null)
    } catch (err) {
      res.status(500).json({ error: 'failed' })
    }
  })

  // Submit qualification proof (screenshot URL or uploaded image)
  app.post('/api/public/vote-events/:eventId/qualify', requireAuth, upload.single('screenshot'), async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT * FROM vote_events WHERE id = ?', [eventId])
      if (!event) return res.status(404).json({ error: 'event_not_found' })
      if (!event.qualification_url) return res.status(400).json({ error: 'event_has_no_qualification' })
      if (event.status !== 'active') return res.status(400).json({ error: 'event_not_active' })

      const userId = await resolveCanonicalUserId(req.user)
      const uid = userId || req.user.id
      const username = req.user.username || req.user.google_name || uid

      // Check if already submitted
      const existing = await db.get('SELECT * FROM vote_event_qualifications WHERE vote_event_id = ? AND user_id = ?', [eventId, uid])
      if (existing) return res.status(409).json({ error: 'already_submitted', qualification: existing })

      let screenshotUrl = req.body?.screenshot_url || ''

      // If file was uploaded, send it to the event channel as an attachment and use the URL
      if (req.file && event.channel_id) {
        try {
          const channel = await fetchTextChannel(event.guild_id, event.channel_id)
          const msg = await channel.send({
            content: `📸 Qualification proof from **${username}** for event **${event.title}**`,
            files: [{ attachment: req.file.buffer, name: req.file.originalname || 'screenshot.png' }]
          })
          // Raw REST returns attachments as array, discord.js as Collection
          const atts = msg.attachments
          if (atts) {
            if (typeof atts.first === 'function' && atts.size > 0) {
              screenshotUrl = atts.first().url
            } else if (Array.isArray(atts) && atts.length > 0) {
              screenshotUrl = atts[0].url
            } else if (atts instanceof Map && atts.size > 0) {
              screenshotUrl = atts.values().next().value?.url
            }
          }
        } catch (uploadErr) {
          console.error('[qualify] discord upload failed:', uploadErr?.message)
        }
      }

      if (!screenshotUrl) return res.status(400).json({ error: 'screenshot_required' })

      await db.run(
        'INSERT INTO vote_event_qualifications (vote_event_id, user_id, username, screenshot_url) VALUES (?, ?, ?, ?)',
        [eventId, uid, username, screenshotUrl]
      )
      const qual = await db.get('SELECT * FROM vote_event_qualifications WHERE vote_event_id = ? AND user_id = ?', [eventId, uid])
      res.json(qual)
    } catch (err) {
      console.error('[qualify] error:', err?.message || err)
      if (err?.message?.includes('UNIQUE constraint')) return res.status(409).json({ error: 'already_submitted' })
      res.status(500).json({ error: 'qualification_failed' })
    }
  })

  // ---- Gambling Events ----
  app.get('/api/admin/guilds/:guildId/gambling-events', requireAuth, requireGuildMember, async (req, res) => {
    const rows = await db.all('SELECT * FROM gambling_events WHERE guild_id = ? ORDER BY id DESC', [req.guild.id])
    res.json(rows)
  })

  app.post('/api/admin/guilds/:guildId/gambling-events', requireAuth, requireGuildOwner, async (req, res) => {
    const {
      channel_id, title, description, mode, prize_amount, currency,
      entry_fee, min_players, max_players, duration_minutes, slots,
      qualification_url,
    } = req.body || {}

    if (!channel_id || !title) return res.status(400).json({ error: 'missing_fields' })
    if (!min_players || !max_players) return res.status(400).json({ error: 'missing_player_limits' })
    if (!Array.isArray(slots) || slots.length < 2) return res.status(400).json({ error: 'at_least_two_slots_required' })

    const endsAt = duration_minutes ? new Date(Date.now() + (Number(duration_minutes) * 60 * 1000)).toISOString() : null
    const numSlots = slots.length

    const r = await db.run(
      `INSERT INTO gambling_events (guild_id, channel_id, title, description, mode, prize_amount, currency, entry_fee, min_players, max_players, duration_minutes, num_slots, created_by, ends_at, qualification_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.guild.id, String(channel_id), String(title), String(description || ''),
       String(mode || 'house'), Number(prize_amount || 0), String(currency || 'SOL'),
       Number(entry_fee || 0), Number(min_players), Number(max_players),
       duration_minutes == null ? null : Number(duration_minutes), numSlots, req.user.id, endsAt,
       qualification_url || null]
    )

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]
      await db.run(
        'INSERT INTO gambling_event_slots (gambling_event_id, slot_number, label, color) VALUES (?, ?, ?, ?)',
        [r.lastID, i + 1, String(s.label || `Slot ${i + 1}`), String(s.color || '#888')]
      )
    }

    const event = await db.get('SELECT * FROM gambling_events WHERE id = ?', [r.lastID])
    res.json(event)
  })

  app.post('/api/admin/guilds/:guildId/gambling-events/:eventId/publish', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      console.log(`[gambling-event] publish requested for event #${eventId}, guild=${req.guild.id}, clientUser=${!!discordClient.user}`)
      const event = await db.get('SELECT * FROM gambling_events WHERE id = ?', [eventId])
      if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'gambling_event_not_found' })

      const channelId = req.body?.channel_id || event.channel_id
      console.log(`[gambling-event] fetching channel ${channelId} for guild ${req.guild.id}`)
      const channel = await fetchTextChannel(req.guild.id, channelId)
      console.log(`[gambling-event] channel fetched: restOnly=${!!channel._restOnly}, id=${channel.id}`)
      const slots = await db.all('SELECT * FROM gambling_event_slots WHERE gambling_event_id = ? ORDER BY slot_number ASC', [eventId])

      // Recalculate ends_at from NOW
      let endTimestamp = null
      if (event.duration_minutes) {
        const newEndsAt = new Date(Date.now() + (event.duration_minutes * 60 * 1000)).toISOString()
        await db.run('UPDATE gambling_events SET ends_at = ? WHERE id = ?', [newEndsAt, eventId])
        endTimestamp = Math.floor(new Date(newEndsAt).getTime() / 1000)
      } else if (event.ends_at) {
        endTimestamp = Math.floor(new Date(event.ends_at).getTime() / 1000)
      }

      const modeLabel = event.mode === 'pot' ? '🏦 Pot Split' : '🏠 House-funded'
      const isPotMode = event.mode === 'pot'
      const entryFee = event.entry_fee || 0
      const requiresPayment = isPotMode && entryFee > 0
      const entryInfo = entryFee > 0 ? `${entryFee} ${event.currency} per bet` : 'Free entry'

      const slotList = slots.map(s => `${s.slot_number}. ${s.label}`).join('\n')

      // Build description with rules & T&Cs
      let desc = event.description || 'Place your bets!'
      desc += '\n\n**📋 How it works:**\n'
      desc += '1️⃣ Click a slot button below to place your bet\n'
      desc += '2️⃣ The wheel spins when max players join or time runs out\n'
      desc += '3️⃣ If your slot wins — you get paid! 💰\n'

      if (requiresPayment) {
        desc += `\n**💰 Entry Requirements:**\n`
        desc += `• Entry fee: **${entryFee} ${event.currency}** per player\n`
        desc += `• You MUST connect your wallet first: \`/user-wallet connect\`\n`
        desc += `• Your wallet must have at least **${entryFee} ${event.currency}** available\n`
        desc += `• Entry fee is committed when you place your bet\n`

        desc += `\n**🏆 Prize Distribution:**\n`
        desc += `• Total pot = all entry fees combined\n`
        desc += `• **90%** of pot split evenly among winner(s)\n`
        desc += `• **10%** retained by the house (server treasury)\n`

        desc += `\n**🔄 Refund Policy:**\n`
        desc += `• If event is cancelled (not enough players), all entries are refunded\n`
        desc += `• Refunds are sent to your connected wallet address\n`
      } else {
        desc += `\n**🏆 Prize Distribution:**\n`
        if (isPotMode) {
          desc += `• **90%** of pot split evenly among winner(s)\n`
          desc += `• **10%** retained by the house (server treasury)\n`
        } else {
          desc += `• Prize: **${Number(event.prize_amount || 0)} ${event.currency}** funded by the house\n`
          desc += `• Full prize amount goes to the winner(s)\n`
        }
      }

      desc += `\n**📜 Rules & Terms:**\n`
      desc += `• One bet per player — no changes after entry\n`
      desc += `• Winners determined by random provably-fair wheel spin\n`
      desc += `• Payouts sent to your connected Solana wallet\n`
      desc += `• By entering, you agree to these terms and accept the outcome\n`
      desc += `• Must be 18+ to participate in wagering events`

      const mainEmbed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle(`🎰 DCB Gambling Event: ${event.title}`)
        .setDescription(desc)
        .addFields(
          { name: '🎲 Mode', value: modeLabel, inline: true },
          { name: '🪑 Players', value: `${event.current_players}/${event.max_players}`, inline: true },
          { name: '✅ Min to Spin', value: `${event.min_players}`, inline: true },
          { name: '🎁 Prize Pool', value: isPotMode ? `${entryInfo} → pot split (90% to winners)` : `${Number(event.prize_amount || 0)} ${event.currency}`, inline: true },
          { name: '🎰 Slots', value: slotList || 'None', inline: false },
        )
        .setFooter({ text: `DisCryptoBank • Gamble #${eventId} • Provably Fair` })
        .setTimestamp()

      if (endTimestamp) mainEmbed.addFields({ name: '⏱️ Ends', value: `<t:${endTimestamp}:R>`, inline: true })

      // Add qualification info to embed if qualification_url is set
      if (event.qualification_url) {
        desc += `\n**🔗 Qualification Required:**\n`
        desc += `• You must qualify before placing a bet\n`
        desc += `• Click the **✅ Qualify** button below to start\n`
        mainEmbed.setDescription(desc)
        mainEmbed.addFields({ name: '🔗 Qualification URL', value: `[Visit this link](${event.qualification_url})` })
      }

      // Build slot bet buttons (up to 5 per row, max 5 rows)
      const components = []

      // Add qualify button row if qualification_url is set
      if (event.qualification_url) {
        const qualifyRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`gamble_qualify_${eventId}`)
            .setLabel('✅ Qualify')
            .setStyle(ButtonStyle.Success)
        )
        components.push(qualifyRow)
      }

      const slotButtons = slots.slice(0, 20).map(s =>
        new ButtonBuilder()
          .setCustomId(`gamble_bet_${eventId}_${s.slot_number}`)
          .setLabel(`${s.label}`)
          .setStyle(ButtonStyle.Primary)
      )

      for (let i = 0; i < slotButtons.length; i += 5) {
        components.push(new ActionRowBuilder().addComponents(...slotButtons.slice(i, i + 5)))
      }

      console.log(`[gambling-event] sending message to channel ${channel.id} with ${components.length} action rows, ${slotButtons.length} buttons`)
      const msg = await channel.send({ embeds: [mainEmbed], components })
      console.log(`[gambling-event] message sent, msg.id=${msg?.id}`)
      await db.run('UPDATE gambling_events SET message_id = ?, channel_id = ? WHERE id = ?', [msg.id, String(channelId), eventId])

      res.json({ ok: true, message_id: msg.id, channel_id: String(channelId) })
    } catch (err) {
      console.error('[gambling-event] publish error:', err?.message || err)
      console.error('[gambling-event] publish stack:', err?.stack)
      res.status(500).json({ error: 'publish_failed', detail: err?.message })
    }
  })

  app.delete('/api/admin/guilds/:guildId/gambling-events/:eventId', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT * FROM gambling_events WHERE id = ?', [eventId])
      if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'not_found' })

      // Remove Discord message if published
      if (event.message_id && event.channel_id) {
        try {
          await discordBotRequest('DELETE', `/channels/${event.channel_id}/messages/${event.message_id}`)
        } catch (_) {}
      }

      await db.run('DELETE FROM gambling_event_qualifications WHERE gambling_event_id = ?', [eventId])
      await db.run('DELETE FROM gambling_event_bets WHERE gambling_event_id = ?', [eventId])
      await db.run('DELETE FROM gambling_event_slots WHERE gambling_event_id = ?', [eventId])
      await db.run('DELETE FROM gambling_events WHERE id = ?', [eventId])
      res.json({ ok: true })
    } catch (err) {
      console.error('[gambling-event] delete error:', err?.message || err)
      res.status(500).json({ error: 'delete_failed' })
    }
  })

  app.patch('/api/admin/guilds/:guildId/gambling-events/:eventId/cancel', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT * FROM gambling_events WHERE id = ?', [eventId])
      if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'not_found' })

      await db.run('UPDATE gambling_events SET status = ? WHERE id = ?', ['cancelled', eventId])

      // Remove Discord message if published
      if (event.message_id && event.channel_id) {
        try {
          await discordBotRequest('DELETE', `/channels/${event.channel_id}/messages/${event.message_id}`)
        } catch (_) {}
      }

      res.json({ ok: true })
    } catch (err) {
      console.error('[gambling-event] cancel error:', err?.message || err)
      res.status(500).json({ error: 'cancel_failed' })
    }
  })

  // ---- Gambling Event Qualifications (Admin) ----
  app.get('/api/admin/guilds/:guildId/gambling-events/:eventId/qualifications', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT * FROM gambling_events WHERE id = ?', [eventId])
      if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'gambling_event_not_found' })
      const rows = await db.all('SELECT * FROM gambling_event_qualifications WHERE gambling_event_id = ? ORDER BY submitted_at DESC', [eventId])
      res.json(rows)
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_qualifications' })
    }
  })

  app.patch('/api/admin/guilds/:guildId/gambling-qualifications/:qualId/review', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const qualId = Number(req.params.qualId)
      const { status } = req.body || {}
      if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'invalid_status' })
      const qual = await db.get('SELECT q.*, e.guild_id FROM gambling_event_qualifications q JOIN gambling_events e ON q.gambling_event_id = e.id WHERE q.id = ?', [qualId])
      if (!qual || qual.guild_id !== req.guild.id) return res.status(404).json({ error: 'qualification_not_found' })
      const reviewerId = await resolveCanonicalUserId(req.user)
      await db.run('UPDATE gambling_event_qualifications SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?',
        [status, reviewerId || req.user.id, qualId])
      const updated = await db.get('SELECT * FROM gambling_event_qualifications WHERE id = ?', [qualId])
      res.json(updated)
    } catch (err) {
      res.status(500).json({ error: 'review_failed' })
    }
  })

  // ---- Gambling Event Qualifications (Public / Participant) ----
  app.get('/api/public/gambling-events/:eventId', requireAuth, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT id, title, description, mode, prize_amount, currency, entry_fee, min_players, max_players, current_players, num_slots, status, qualification_url, ends_at, created_at FROM gambling_events WHERE id = ?', [eventId])
      if (!event) return res.status(404).json({ error: 'not_found' })
      const slots = await db.all('SELECT slot_number, label, color FROM gambling_event_slots WHERE gambling_event_id = ? ORDER BY slot_number ASC', [eventId])
      res.json({ ...event, slots })
    } catch (err) {
      res.status(500).json({ error: 'failed' })
    }
  })

  app.get('/api/public/gambling-events/:eventId/my-qualification', requireAuth, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const userId = await resolveCanonicalUserId(req.user)
      const qual = await db.get('SELECT * FROM gambling_event_qualifications WHERE gambling_event_id = ? AND user_id = ?', [eventId, userId || req.user.id])
      res.json(qual || null)
    } catch (err) {
      res.status(500).json({ error: 'failed' })
    }
  })

  app.post('/api/public/gambling-events/:eventId/qualify', requireAuth, upload.single('screenshot'), async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT * FROM gambling_events WHERE id = ?', [eventId])
      if (!event) return res.status(404).json({ error: 'event_not_found' })
      if (!event.qualification_url) return res.status(400).json({ error: 'event_has_no_qualification' })
      if (event.status !== 'active') return res.status(400).json({ error: 'event_not_active' })

      const userId = await resolveCanonicalUserId(req.user)
      const uid = userId || req.user.id
      const username = req.user.username || req.user.google_name || uid

      const existing = await db.get('SELECT * FROM gambling_event_qualifications WHERE gambling_event_id = ? AND user_id = ?', [eventId, uid])
      if (existing) return res.status(409).json({ error: 'already_submitted', qualification: existing })

      let screenshotUrl = req.body?.screenshot_url || ''

      if (req.file && event.channel_id) {
        try {
          const channel = await fetchTextChannel(event.guild_id, event.channel_id)
          const msg = await channel.send({
            content: `📸 Qualification proof from **${username}** for horse race **${event.title}**`,
            files: [{ attachment: req.file.buffer, name: req.file.originalname || 'screenshot.png' }]
          })
          const atts = msg.attachments
          if (atts) {
            if (typeof atts.first === 'function' && atts.size > 0) {
              screenshotUrl = atts.first().url
            } else if (Array.isArray(atts) && atts.length > 0) {
              screenshotUrl = atts[0].url
            } else if (atts instanceof Map && atts.size > 0) {
              screenshotUrl = atts.values().next().value?.url
            }
          }
        } catch (uploadErr) {
          console.error('[gambling-qualify] discord upload failed:', uploadErr?.message)
        }
      }

      if (!screenshotUrl) return res.status(400).json({ error: 'screenshot_required' })

      await db.run(
        'INSERT INTO gambling_event_qualifications (gambling_event_id, user_id, username, screenshot_url) VALUES (?, ?, ?, ?)',
        [eventId, uid, username, screenshotUrl]
      )
      const qual = await db.get('SELECT * FROM gambling_event_qualifications WHERE gambling_event_id = ? AND user_id = ?', [eventId, uid])
      res.json(qual)
    } catch (err) {
      console.error('[gambling-qualify] error:', err?.message || err)
      if (err?.message?.includes('UNIQUE constraint')) return res.status(409).json({ error: 'already_submitted' })
      res.status(500).json({ error: 'qualification_failed' })
    }
  })

  // ==================================================================
  //  POKER EVENTS  (Admin CRUD + Publish)
  // ==================================================================

  /* ---- List poker events ---- */
  app.get('/api/admin/guilds/:guildId/poker-events', requireAuth, requireGuildMember, async (req, res) => {
    const rows = await db.all('SELECT * FROM poker_events WHERE guild_id = ? ORDER BY id DESC', [req.guild.id])
    res.json(rows)
  })

  /* ---- Create poker event ---- */
  app.post('/api/admin/guilds/:guildId/poker-events', requireAuth, requireGuildOwner, async (req, res) => {
    const {
      channel_id, title, description, mode, buy_in, currency,
      small_blind, big_blind, starting_chips, max_players, turn_timer,
    } = req.body || {}

    if (!channel_id || !title) return res.status(400).json({ error: 'missing_fields' })

    const r = await db.run(
      `INSERT INTO poker_events (guild_id, channel_id, title, description, mode, buy_in, currency, small_blind, big_blind, starting_chips, max_players, turn_timer, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.guild.id, String(channel_id), String(title), String(description || ''),
       String(mode || 'pot'), Number(buy_in || 0), String(currency || 'SOL'),
       Number(small_blind || 5), Number(big_blind || 10), Number(starting_chips || 1000),
       Number(max_players || 6), Number(turn_timer || 30), req.user.id]
    )

    const event = await db.get('SELECT * FROM poker_events WHERE id = ?', [r.lastID])
    res.json(event)
  })

  /* ---- Publish poker event to Discord ---- */
  app.post('/api/admin/guilds/:guildId/poker-events/:eventId/publish', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT * FROM poker_events WHERE id = ?', [eventId])
      if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'poker_event_not_found' })

      const channelId = req.body?.channel_id || event.channel_id
      const channel = await fetchTextChannel(req.guild.id, channelId)

      const isPotMode = event.mode === 'pot'
      const buyIn = event.buy_in || 0
      const hasBuyIn = isPotMode && buyIn > 0

      let desc = event.description || 'Texas Hold\'em poker — sit down, play, and win!'
      desc += '\n\n**🃏 How it works:**\n'
      desc += '1️⃣ Click **Join Table** to take a seat\n'
      if (hasBuyIn) {
        desc += `2️⃣ Pay the buy-in: **${buyIn} ${event.currency}** from your wallet\n`
        desc += '3️⃣ Play Texas Hold\'em — bet, bluff, and win chips!\n'
        desc += '4️⃣ When the table closes, chip stacks convert to SOL payouts 💰\n'
      } else {
        desc += '2️⃣ Play Texas Hold\'em — bet, bluff, and win chips!\n'
        desc += '3️⃣ Casual play — no real money involved\n'
      }

      if (hasBuyIn) {
        desc += `\n**💰 Buy-in & Payouts:**\n`
        desc += `• Buy-in: **${buyIn} ${event.currency}** per seat\n`
        desc += `• Starting chips: **${event.starting_chips}**\n`
        desc += `• 1 chip ≈ ${(buyIn / event.starting_chips).toFixed(6)} ${event.currency}\n`
        desc += `• **90%** of total pot paid to winners proportional to final chips\n`
        desc += `• **10%** retained by the house (server treasury)\n`
        desc += `\n**🔄 Refund Policy:**\n`
        desc += `• If event is cancelled before play, all buy-ins are refunded\n`
        desc += `• Refunds sent to your connected wallet address\n`
      }

      desc += `\n**⚙️ Table Settings:**\n`
      desc += `• Blinds: **${event.small_blind}/${event.big_blind}**\n`
      desc += `• Players: **2–${event.max_players}**\n`
      desc += `• Turn Time: **${event.turn_timer}s**\n`

      desc += `\n**📜 Rules:**\n`
      desc += `• Standard Texas Hold\'em rules\n`
      desc += `• One seat per player\n`
      if (hasBuyIn) {
        desc += `• Must connect wallet first: \`/user-wallet connect\`\n`
        desc += `• Must be 18+ to participate in wagering\n`
      }

      const mainEmbed = new EmbedBuilder()
        .setColor('#1B5E20')
        .setTitle(`🃏 DCB Poker: ${event.title}`)
        .setDescription(desc)
        .addFields(
          { name: '🎲 Mode', value: hasBuyIn ? `🏦 Pot Split (${buyIn} ${event.currency} buy-in)` : '🎮 Casual (play money)', inline: true },
          { name: '🪑 Seats', value: `0/${event.max_players}`, inline: true },
          { name: '♠️♥️ Blinds', value: `${event.small_blind}/${event.big_blind}`, inline: true },
          { name: '💰 Starting Chips', value: `${event.starting_chips}`, inline: true },
          { name: '⏱️ Turn Timer', value: `${event.turn_timer}s`, inline: true },
        )
        .setFooter({ text: `DisCryptoBank • Poker #${eventId} • Texas Hold'em` })
        .setTimestamp()

      const components = []
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`poker_join_${eventId}`)
          .setLabel('🪑 Join Table')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`poker_status_${eventId}`)
          .setLabel('📊 Table Info')
          .setStyle(ButtonStyle.Secondary),
      )
      components.push(row)

      const msg = await channel.send({ embeds: [mainEmbed], components })
      await db.run('UPDATE poker_events SET message_id = ?, channel_id = ? WHERE id = ?', [msg.id, String(channelId), eventId])

      res.json({ ok: true, message_id: msg.id, channel_id: String(channelId) })
    } catch (err) {
      console.error('[poker-event] publish error:', err?.message || err)
      res.status(500).json({ error: 'publish_failed', detail: err?.message })
    }
  })

  /* ---- Delete poker event ---- */
  app.delete('/api/admin/guilds/:guildId/poker-events/:eventId', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT * FROM poker_events WHERE id = ?', [eventId])
      if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'not_found' })

      if (event.message_id && event.channel_id) {
        try {
          await discordBotRequest('DELETE', `/channels/${event.channel_id}/messages/${event.message_id}`)
        } catch (_) {}
      }

      await db.run('DELETE FROM poker_event_players WHERE poker_event_id = ?', [eventId])
      await db.run('DELETE FROM poker_events WHERE id = ?', [eventId])
      res.json({ ok: true })
    } catch (err) {
      console.error('[poker-event] delete error:', err?.message || err)
      res.status(500).json({ error: 'delete_failed' })
    }
  })

  /* ---- Cancel poker event ---- */
  app.patch('/api/admin/guilds/:guildId/poker-events/:eventId/cancel', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const eventId = Number(req.params.eventId)
      const event = await db.get('SELECT * FROM poker_events WHERE id = ?', [eventId])
      if (!event || event.guild_id !== req.guild.id) return res.status(404).json({ error: 'not_found' })

      await db.run('UPDATE poker_events SET status = ? WHERE id = ?', ['cancelled', eventId])

      if (event.message_id && event.channel_id) {
        try {
          await discordBotRequest('DELETE', `/channels/${event.channel_id}/messages/${event.message_id}`)
        } catch (_) {}
      }

      res.json({ ok: true })
    } catch (err) {
      console.error('[poker-event] cancel error:', err?.message || err)
      res.status(500).json({ error: 'cancel_failed' })
    }
  })

  // ---- Dashboard Stats ----
  app.get('/api/admin/guilds/:guildId/dashboard/stats', requireAuth, requireGuildMember, async (req, res) => {
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

  app.get('/api/admin/guilds/:guildId/dashboard/activity', requireAuth, requireGuildMember, async (req, res) => {
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

  // ---- Completed Contests (contests + vote events + bulk tasks) ----
  app.get('/api/admin/guilds/:guildId/dashboard/completed-contests', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 100)
      const rows = await db.all(
        `SELECT * FROM (
          SELECT id, guild_id, title, description, prize_amount, currency, status,
                 current_entries AS entries, max_entries, ends_at, created_at, 'contest' AS source_type
          FROM contests WHERE guild_id = ? AND status IN ('completed', 'ended')
          UNION ALL
          SELECT id, guild_id, title, description, prize_amount, currency, status,
                 current_participants AS entries, max_participants AS max_entries, ends_at, created_at, 'vote_event' AS source_type
          FROM vote_events WHERE guild_id = ? AND status IN ('completed', 'ended')
          UNION ALL
          SELECT id, guild_id, title, description, payout_amount AS prize_amount,
                 payout_currency AS currency, status,
                 filled_slots AS entries, total_slots AS max_entries, NULL AS ends_at, created_at, 'bulk_task' AS source_type
          FROM bulk_tasks WHERE guild_id = ? AND (status = 'completed' OR (filled_slots >= total_slots AND total_slots > 0))
        ) ORDER BY created_at DESC LIMIT ?`,
        [req.guild.id, req.guild.id, req.guild.id, limit]
      )
      res.json(rows || [])
    } catch (err) {
      console.error('[completed-contests] error:', err?.message || err)
      res.status(500).json({ error: 'failed_to_get_completed_contests' })
    }
  })

  app.get('/api/admin/guilds/:guildId/dashboard/balance', requireAuth, requireGuildMember, async (req, res) => {
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
  app.get('/api/admin/guilds/:guildId/wallet', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const wallet = await db.get('SELECT * FROM guild_wallets WHERE guild_id = ?', [req.guild.id])
      if (wallet) {
        // Never expose wallet_secret to the web frontend — just indicate if it's set
        const { wallet_secret, ...safeWallet } = wallet
        // Decrypt to check truthiness, but never send the value
        const decrypted = decryptSecret(wallet_secret)
        res.json({ ...safeWallet, has_secret: !!decrypted })
      } else {
        res.json(null)
      }
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_wallet' })
    }
  })

  app.post('/api/admin/guilds/:guildId/wallet', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { wallet_address, label, network, wallet_secret } = req.body || {}
      if (!wallet_address || typeof wallet_address !== 'string' || wallet_address.length < 32 || wallet_address.length > 44) {
        return res.status(400).json({ error: 'invalid_wallet_address' })
      }
      // Reject if wallet_secret looks like a public address (not a real secret key)
      if (wallet_secret && wallet_secret.trim() === wallet_address.trim()) {
        return res.status(400).json({ error: 'secret_is_address', message: 'The private key you entered is your public wallet address. Please enter your actual secret/private key (~88 chars).' })
      }
      if (wallet_secret && !wallet_secret.trim().startsWith('[') && wallet_secret.trim().length >= 32 && wallet_secret.trim().length <= 50) {
        return res.status(400).json({ error: 'secret_too_short', message: 'That looks like a public wallet address (32-44 chars), not a private key. A Solana secret key is ~88 characters in base58. Export from Phantom → Settings → Security → Show Secret Key.' })
      }
      await db.run(
        `INSERT INTO guild_wallets (guild_id, wallet_address, configured_by, label, network, wallet_secret, configured_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(guild_id) DO UPDATE SET
           wallet_address = excluded.wallet_address,
           configured_by = excluded.configured_by,
           label = excluded.label,
           network = excluded.network,
           wallet_secret = excluded.wallet_secret,
           updated_at = CURRENT_TIMESTAMP`,
        [req.guild.id, wallet_address.trim(), req.user.id, label || 'Treasury', network || 'mainnet-beta', wallet_secret ? encryptSecret(wallet_secret) : null]
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
      if (updates.wallet_secret !== undefined) {
        // Validate wallet_secret is not a public address
        const existingWallet = await db.get('SELECT wallet_address FROM guild_wallets WHERE guild_id = ?', [req.guild.id])
        if (existingWallet && updates.wallet_secret === existingWallet.wallet_address) {
          return res.status(400).json({ error: 'secret_is_address', message: 'The private key you entered is your public wallet address. Please enter your actual secret/private key (~88 chars).' })
        }
        if (updates.wallet_secret && !updates.wallet_secret.trim().startsWith('[') && updates.wallet_secret.trim().length >= 32 && updates.wallet_secret.trim().length <= 50) {
          return res.status(400).json({ error: 'secret_too_short', message: 'That looks like a public wallet address (32-44 chars), not a private key. A Solana secret key is ~88 characters in base58. Export from Phantom → Settings → Security → Show Secret Key.' })
        }
        fields.push('wallet_secret = ?'); params.push(updates.wallet_secret ? encryptSecret(updates.wallet_secret) : updates.wallet_secret)
      }
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
  app.get('/api/admin/guilds/:guildId/transactions', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50
      const rows = await db.all('SELECT * FROM transactions WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?', [req.guild.id, limit])
      res.json(rows || [])
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_transactions' })
    }
  })

  // ---- History KPI Stats ----
  app.get('/api/admin/guilds/:guildId/history/stats', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const gid = req.guild.id
      const safeQuery = async (label, query, params) => {
        try { return await db.get(query, params) } catch (e) { console.error(`[history/stats] ${label} query failed:`, e?.message); return null }
      }
      const [txStats, proofStats, qualStats, voteEventStats, recentTx] = await Promise.all([
        safeQuery('transactions',
          `SELECT COUNT(*) as total_count, COALESCE(SUM(amount), 0) as total_amount,
                COUNT(CASE WHEN status='confirmed' THEN 1 END) as confirmed_count,
                COUNT(CASE WHEN status='pending' THEN 1 END) as pending_count,
                COALESCE(SUM(CASE WHEN created_at > datetime('now', '-7 days') THEN amount ELSE 0 END), 0) as week_amount,
                COUNT(CASE WHEN created_at > datetime('now', '-7 days') THEN 1 END) as week_count,
                COALESCE(SUM(CASE WHEN created_at > datetime('now', '-30 days') THEN amount ELSE 0 END), 0) as month_amount
                FROM transactions WHERE guild_id = ?`, [gid]),
        safeQuery('proofs',
          `SELECT COUNT(*) as total,
                COUNT(CASE WHEN status='pending' THEN 1 END) as pending,
                COUNT(CASE WHEN status='approved' THEN 1 END) as approved,
                COUNT(CASE WHEN status='rejected' THEN 1 END) as rejected,
                COUNT(CASE WHEN submitted_at > datetime('now', '-7 days') THEN 1 END) as week_submissions
                FROM proof_submissions WHERE guild_id = ?`, [gid]),
        safeQuery('qualifications',
          `SELECT COUNT(*) as total,
                COUNT(CASE WHEN q.status='approved' THEN 1 END) as approved,
                COUNT(CASE WHEN q.status='pending' THEN 1 END) as pending,
                COUNT(CASE WHEN q.status='rejected' THEN 1 END) as rejected
                FROM vote_event_qualifications q
                JOIN vote_events ve ON q.vote_event_id = ve.id
                WHERE ve.guild_id = ?`, [gid]),
        safeQuery('voteEvents',
          `SELECT COUNT(*) as total,
                COUNT(CASE WHEN status='active' THEN 1 END) as active,
                COUNT(CASE WHEN status IN ('completed','ended') THEN 1 END) as completed,
                COALESCE(SUM(current_participants), 0) as total_participants
                FROM vote_events WHERE guild_id = ?`, [gid]),
        safeQuery('recentTx',
          `SELECT * FROM transactions WHERE guild_id = ? ORDER BY created_at DESC LIMIT 1`, [gid]),
      ])
      res.json({
        transactions: txStats || {},
        proofs: proofStats || {},
        qualifications: qualStats || {},
        voteEvents: voteEventStats || {},
        lastTransaction: recentTx || null,
      })
    } catch (err) {
      console.error('[history/stats] error:', err?.message || err)
      res.status(500).json({ error: 'failed_to_get_history_stats' })
    }
  })

  // ---- Events (Scheduled Events) ----
  app.get('/api/admin/guilds/:guildId/events', requireAuth, requireGuildMember, async (req, res) => {
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

  // ---- Image proxy for Discord CDN (attachment URLs expire) ----
  app.get('/api/image-proxy', requireAuth, async (req, res) => {
    try {
      const url = req.query.url
      if (!url || typeof url !== 'string') return res.status(400).json({ error: 'missing_url' })
      const parsed = new URL(url)
      // Allow Discord CDN and any HTTPS image URL
      if (parsed.protocol !== 'https:') return res.status(403).json({ error: 'https_only' })
      const upstream = await axios.get(url, { responseType: 'stream', timeout: 10000 })
      const ct = upstream.headers['content-type']
      if (ct) res.setHeader('Content-Type', ct)
      res.setHeader('Cache-Control', 'public, max-age=86400')
      upstream.data.pipe(res)
    } catch (err) {
      const status = err?.response?.status || 502
      res.status(status).json({ error: 'proxy_failed', status })
    }
  })

  // ---- Workers / DCB Roles ----

  // ---- Proof Submissions (includes vote event qualifications) ----
  app.get('/api/admin/guilds/:guildId/proofs', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const status = req.query.status || 'pending'
      const limit = Math.min(Number(req.query.limit) || 100, 500)

      // Build WHERE fragment for the status filter
      const statusWhere = status === 'all' ? '' : `WHERE combined.status = ?`
      const statusParams = status === 'all' ? [] : [status]

      const sql = `
        SELECT * FROM (
          SELECT ps.id, bt.title, ta.assigned_user_id, ps.screenshot_url, ps.verification_url,
                 ps.notes, ps.status, bt.payout_amount, bt.payout_currency, ps.submitted_at,
                 'task' as source
          FROM proof_submissions ps
          LEFT JOIN task_assignments ta ON ps.task_assignment_id = ta.id
          LEFT JOIN bulk_tasks bt ON ta.bulk_task_id = bt.id
          WHERE ps.guild_id = ?
          UNION ALL
          SELECT q.id, ve.title, q.user_id as assigned_user_id, q.screenshot_url, NULL as verification_url,
                 NULL as notes, q.status, ve.prize_amount as payout_amount, ve.currency as payout_currency,
                 q.submitted_at,
                 'qualification' as source
          FROM vote_event_qualifications q
          JOIN vote_events ve ON q.vote_event_id = ve.id
          WHERE ve.guild_id = ?
        ) combined
        ${statusWhere}
        ORDER BY combined.submitted_at DESC
        LIMIT ?`

      const params = [req.guild.id, req.guild.id, ...statusParams, limit]
      const rows = await db.all(sql, params)
      res.json(rows || [])
    } catch (err) {
      console.error('[proofs] GET error:', err?.message || err)
      res.status(500).json({ error: 'failed_to_get_proofs' })
    }
  })

  app.get('/api/admin/guilds/:guildId/proofs/:proofId', requireAuth, requireGuildMember, async (req, res) => {
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

  app.get('/api/admin/guilds/:guildId/workers', requireAuth, requireGuildMember, async (req, res) => {
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
           COALESCE(SUM(wds.events_created), 0) as total_events_created,
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
          if (typeof req.guild.members?.fetch === 'function') {
            const member = await req.guild.members.fetch(w.discord_id)
            return { ...w, avatar: member.user.displayAvatarURL({ size: 64 }), display_name: member.displayName, status: member.presence?.status || 'offline', joined_guild_at: member.joinedAt?.toISOString() || null, account_created_at: member.user.createdAt?.toISOString() || null }
          }
          // REST-only fallback
          const m = await fetchMemberViaREST(req.guild.id, w.discord_id)
          if (m) {
            const avatar = m.user?.avatar ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=64` : null
            return { ...w, avatar, display_name: m.nick || m.user?.global_name || m.user?.username || w.username, status: 'offline', joined_guild_at: m.joined_at || null, account_created_at: null }
          }
          return { ...w, avatar: null, display_name: w.username, status: 'offline', joined_guild_at: null, account_created_at: null }
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

  app.post('/api/admin/guilds/:guildId/workers', requireAuth, requireGuildOwner, requireStrictOwner, async (req, res) => {
    try {
      const { discord_id, role } = req.body || {}
      if (!discord_id) return res.status(400).json({ error: 'missing_discord_id' })
      const workerRole = ['staff', 'admin'].includes(role) ? role : 'staff'
      let username = 'unknown'
      try {
        if (typeof req.guild.members?.fetch === 'function') {
          const m = await req.guild.members.fetch(discord_id); username = m.user.username
        } else {
          const m = await fetchMemberViaREST(req.guild.id, discord_id)
          if (m?.user?.username) username = m.user.username
        }
      } catch (_) {}
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

  app.patch('/api/admin/guilds/:guildId/workers/:discordId', requireAuth, requireGuildOwner, requireStrictOwner, async (req, res) => {
    try {
      const { role } = req.body || {}
      if (!['staff', 'admin'].includes(role)) return res.status(400).json({ error: 'invalid_role' })
      await db.run('UPDATE dcb_workers SET role = ? WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL', [role, req.guild.id, req.params.discordId])
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_update_worker' })
    }
  })

  app.delete('/api/admin/guilds/:guildId/workers/:discordId', requireAuth, requireGuildOwner, requireStrictOwner, async (req, res) => {
    try {
      await db.run('UPDATE dcb_workers SET removed_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL', [req.guild.id, req.params.discordId])
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: 'failed_to_remove_worker' })
    }
  })

  app.get('/api/admin/guilds/:guildId/workers/:discordId', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const worker = await db.get('SELECT * FROM dcb_workers WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL', [req.guild.id, req.params.discordId])
      if (!worker) return res.status(404).json({ error: 'worker_not_found' })
      const stats = await db.get(
        `SELECT COALESCE(SUM(commands_run),0) as total_commands, COALESCE(SUM(messages_sent),0) as total_messages,
         COALESCE(SUM(payouts_issued),0) as total_payouts_issued, COALESCE(SUM(payout_total),0) as total_payout_amount,
         COALESCE(SUM(proofs_reviewed),0) as total_proofs_reviewed, COALESCE(SUM(online_minutes),0) as total_online_minutes,
         COALESCE(SUM(events_created),0) as total_events_created,
         COUNT(DISTINCT stat_date) as active_days
         FROM worker_daily_stats WHERE guild_id = ? AND discord_id = ? AND stat_date >= date('now', '-30 days')`,
        [req.guild.id, req.params.discordId]
      )
      const activity = await db.all('SELECT * FROM worker_activity WHERE guild_id = ? AND discord_id = ? ORDER BY created_at DESC LIMIT 50', [req.guild.id, req.params.discordId])
      let enriched = { ...worker, ...(stats || {}), activity: activity || [] }
      try {
        if (typeof req.guild.members?.fetch === 'function') {
          const member = await req.guild.members.fetch(req.params.discordId)
          enriched.avatar = member.user.displayAvatarURL({ size: 128 })
          enriched.display_name = member.displayName
          enriched.status = member.presence?.status || 'offline'
          enriched.joined_guild_at = member.joinedAt?.toISOString() || null
          enriched.account_created_at = member.user.createdAt?.toISOString() || null
        } else {
          const m = await fetchMemberViaREST(req.guild.id, req.params.discordId)
          if (m) {
            enriched.avatar = m.user?.avatar ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=128` : null
            enriched.display_name = m.nick || m.user?.global_name || m.user?.username || worker.username
            enriched.status = 'offline'
            enriched.joined_guild_at = m.joined_at || null
          }
        }
      } catch (_) {}
      res.json(enriched)
    } catch (err) {
      res.status(500).json({ error: 'failed_to_get_worker' })
    }
  })

  app.get('/api/admin/guilds/:guildId/workers-activity', requireAuth, requireGuildMember, async (req, res) => {
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

  // ---- Worker Payroll: Pay Staff from Treasury ----

  // Check if a worker has a connected DCB user-wallet
  app.get('/api/admin/guilds/:guildId/workers/:discordId/wallet', requireAuth, requireGuildMember, async (req, res) => {
    try {
      // Try multiple sources: user_wallets table first, then users table (guild-scoped or global)
      let walletRow = null
      try {
        walletRow = await db.get(
          `SELECT solana_address FROM user_wallets WHERE discord_id = ?`,
          [req.params.discordId]
        )
      } catch (dbErr) {
        console.warn('[worker-wallet] user_wallets query failed:', dbErr?.message)
      }
      if (walletRow?.solana_address) {
        return res.json({ wallet_address: walletRow.solana_address, connected: true })
      }
      // Fallback: check users table (use solana_address only — wallet_address column may not exist)
      let userRow = null
      try {
        userRow = await db.get(
          `SELECT solana_address FROM users WHERE discord_id = ? AND solana_address IS NOT NULL LIMIT 1`,
          [req.params.discordId]
        )
      } catch (dbErr) {
        console.warn('[worker-wallet] users table query failed:', dbErr?.message)
      }
      if (userRow?.solana_address) {
        return res.json({ wallet_address: userRow.solana_address, connected: true })
      }
      // Fallback: try the bot's integrated API (shares bot's DB which has /user-wallet connect data)
      try {
        const BOT_API_URL = process.env.DCB_BOT_API_URL || process.env.BOT_API_URL || ''
        if (BOT_API_URL) {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 5000)
          try {
            const botRes = await fetch(`${BOT_API_URL.replace(/\/$/, '')}/api/internal/user-wallet/${req.params.discordId}`, {
              headers: { 'x-dcb-internal-secret': process.env.DCB_INTERNAL_SECRET || '' },
              signal: controller.signal
            })
            clearTimeout(timeout)
            if (botRes.ok) {
              const botData = await botRes.json()
              if (botData?.wallet_address) {
                // Cache it locally for future lookups
                try {
                  await db.run(
                    `INSERT INTO user_wallets (discord_id, solana_address, username, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                     ON CONFLICT(discord_id) DO UPDATE SET solana_address = excluded.solana_address, updated_at = CURRENT_TIMESTAMP`,
                    [req.params.discordId, botData.wallet_address, botData.username || null]
                  )
                } catch (_) {}
                console.log(`[worker-wallet] Synced wallet from bot for ${req.params.discordId}: ${botData.wallet_address.slice(0, 8)}...`)
                return res.json({ wallet_address: botData.wallet_address, connected: true })
              }
            }
          } catch (fetchErr) {
            clearTimeout(timeout)
            console.warn('[worker-wallet] Bot API fetch failed:', fetchErr?.message)
          }
        }
      } catch (botErr) {
        console.warn('[worker-wallet] Bot API fallback failed:', botErr?.message)
      }
      res.json({ wallet_address: null, connected: false })
    } catch (err) {
      console.error('[worker-wallet] error:', err?.message || err)
      res.status(500).json({ error: 'failed_to_get_wallet' })
    }
  })

  // Manually set a worker's wallet address — OWNER ONLY.
  // This lets owners enter a wallet when the bot is down or the worker hasn't run /user-wallet connect yet.
  app.put('/api/admin/guilds/:guildId/workers/:discordId/wallet', requireAuth, requireGuildOwner, async (req, res) => {
    try {
      const { wallet_address } = req.body || {}
      if (!wallet_address || typeof wallet_address !== 'string' || wallet_address.trim().length < 32 || wallet_address.trim().length > 48) {
        return res.status(400).json({ error: 'invalid_wallet', message: 'Please provide a valid Solana wallet address (32-44 characters).' })
      }
      const address = wallet_address.trim()

      // Validate it looks like base58 (Solana addresses)
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
        return res.status(400).json({ error: 'invalid_wallet', message: 'Invalid Solana address format.' })
      }

      // Verify this worker exists in the guild
      const worker = await db.get(
        'SELECT * FROM dcb_workers WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL',
        [req.guild.id, req.params.discordId]
      )
      if (!worker) {
        return res.status(404).json({ error: 'worker_not_found' })
      }

      // Upsert into user_wallets
      await db.run(
        `INSERT INTO user_wallets (discord_id, solana_address, username, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(discord_id) DO UPDATE SET solana_address = excluded.solana_address, updated_at = CURRENT_TIMESTAMP`,
        [req.params.discordId, address, worker.username || null]
      )

      console.log(`[worker-wallet] Owner manually set wallet for ${req.params.discordId}: ${address.slice(0, 8)}...`)
      res.json({ ok: true, wallet_address: address })
    } catch (err) {
      console.error('[worker-wallet] manual set error:', err?.message || err)
      res.status(500).json({ error: 'failed_to_set_wallet' })
    }
  })

  // Pay a worker — OWNER OR ADMIN. Sends SOL from guild treasury to worker's connected user-wallet.
  // Accepts amount in USD, converts to SOL at current market price.
  app.post('/api/admin/guilds/:guildId/workers/:discordId/pay', requireAuth, requireGuildOwner, async (req, res) => {
    let step = 'init'
    try {
      // Owner or admin check — requireGuildOwner already verified the user is owner or admin
      if (req.userRole !== 'owner' && req.userRole !== 'admin') {
        return res.status(403).json({ error: 'owner_only', message: 'Only the server owner or an admin can pay staff.' })
      }

      step = 'parse_amount'
      const { amount_usd, memo } = req.body || {}
      const amountUsd = Number(amount_usd)
      if (!amountUsd || amountUsd <= 0 || amountUsd > 100000) {
        return res.status(400).json({ error: 'invalid_amount', message: 'Amount must be between $0.01 and $100,000 USD.' })
      }

      // 1. Verify worker exists and is active
      step = 'find_worker'
      const worker = await db.get(
        'SELECT * FROM dcb_workers WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL',
        [req.guild.id, req.params.discordId]
      )
      if (!worker) return res.status(404).json({ error: 'worker_not_found' })

      // 2. Get worker's connected wallet address (check user_wallets first, then users)
      step = 'wallet_lookup'
      let recipientAddress = null
      // Check user_wallets table first
      try {
        const walletRow = await db.get(
          `SELECT solana_address FROM user_wallets WHERE discord_id = ?`,
          [req.params.discordId]
        )
        if (walletRow?.solana_address) recipientAddress = walletRow.solana_address
      } catch (e) { console.warn('[payroll] user_wallets lookup failed:', e?.message) }

      // Fallback: check users table (use solana_address only — wallet_address may not exist)
      if (!recipientAddress) {
        try {
          const userRow = await db.get(
            `SELECT solana_address FROM users WHERE discord_id = ? AND solana_address IS NOT NULL LIMIT 1`,
            [req.params.discordId]
          )
          if (userRow?.solana_address) recipientAddress = userRow.solana_address
        } catch (e) { console.warn('[payroll] users table lookup failed:', e?.message) }
      }

      // Fallback: try the bot's integrated API if wallet not found locally
      if (!recipientAddress) {
        try {
          const BOT_API_URL = process.env.DCB_BOT_API_URL || process.env.BOT_API_URL || ''
          if (BOT_API_URL) {
            const _ac = new AbortController(); const _to = setTimeout(() => _ac.abort(), 5000)
            const botRes = await fetch(`${BOT_API_URL.replace(/\/$/, '')}/api/internal/user-wallet/${req.params.discordId}`, {
              headers: { 'x-dcb-internal-secret': process.env.DCB_INTERNAL_SECRET || '' },
              signal: _ac.signal
            })
            clearTimeout(_to)
            if (botRes.ok) {
              const botData = await botRes.json()
              if (botData?.wallet_address) {
                recipientAddress = botData.wallet_address
                // Cache it locally
                try {
                  await db.run(
                    `INSERT INTO user_wallets (discord_id, solana_address, username, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                     ON CONFLICT(discord_id) DO UPDATE SET solana_address = excluded.solana_address, updated_at = CURRENT_TIMESTAMP`,
                    [req.params.discordId, botData.wallet_address, botData.username || null]
                  )
                } catch (_) {}
                console.log(`[payroll] Synced wallet from bot for ${req.params.discordId}: ${botData.wallet_address.slice(0, 8)}...`)
              }
            }
          }
        } catch (botErr) {
          console.warn('[payroll] Bot API wallet fallback failed:', botErr?.message)
        }
      }
      if (!recipientAddress) {
        return res.status(400).json({ error: 'no_wallet', message: 'This worker has not connected a DisCryptoBank user-wallet. They must run /user-wallet connect first.' })
      }

      // 3. Get guild treasury wallet + secret
      step = 'treasury_lookup'
      const guildWallet = await db.get('SELECT * FROM guild_wallets WHERE guild_id = ?', [req.guild.id])
      if (!guildWallet?.wallet_address) {
        return res.status(400).json({ error: 'no_treasury', message: 'No treasury wallet configured. Set one up in the Treasury tab.' })
      }
      if (!guildWallet.wallet_secret) {
        return res.status(400).json({ error: 'no_secret', message: 'Treasury wallet private key not configured. Add it in the Treasury tab to enable payouts.' })
      }

      // 4. Fetch SOL price to convert USD → SOL
      step = 'fetch_sol_price'
      let solPrice = 0
      try {
        const priceRes = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { timeout: 5000 })
        solPrice = priceRes.data?.solana?.usd || 0
      } catch (_) {}

      if (!solPrice || solPrice <= 0) {
        return res.status(503).json({ error: 'price_unavailable', message: 'Unable to fetch SOL price. Please try again in a moment.' })
      }

      // Convert USD to SOL
      const amountSol = amountUsd / solPrice

      // 5. Create pending payout record
      step = 'create_payout_record'
      const payerDiscordId = await resolveCanonicalUserId(req.user)
      const { lastID: payoutId } = await db.run(
        `INSERT INTO worker_payouts (guild_id, recipient_discord_id, recipient_address, amount_sol, amount_usd, sol_price_at_time, status, memo, paid_by)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [req.guild.id, req.params.discordId, recipientAddress, amountSol, amountUsd, solPrice, memo || null, payerDiscordId]
      )

      // 6. Execute Solana transfer
      step = 'solana_transfer'
      try {
        const { Connection, PublicKey, Transaction: SolTransaction, SystemProgram, sendAndConfirmTransaction, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js')

        // Base58 decoder (avoids ESM-only bs58 v5 require() issue)
        const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
        function decodeBase58(str) {
          const bytes = []
          for (const c of str) {
            let carry = BASE58_ALPHABET.indexOf(c)
            if (carry < 0) throw new Error('Invalid base58 character: ' + c)
            for (let j = 0; j < bytes.length; j++) {
              carry += bytes[j] * 58
              bytes[j] = carry & 0xff
              carry >>= 8
            }
            while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8 }
          }
          for (const c of str) { if (c === '1') bytes.push(0); else break }
          return new Uint8Array(bytes.reverse())
        }

        const rpcUrl = guildWallet.network === 'devnet'
          ? 'https://api.devnet.solana.com'
          : (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com')
        const conn = new Connection(rpcUrl, 'confirmed')

        // Parse treasury secret key — decrypt if encrypted
        let senderKeypair
        const rawSecret = guildWallet.wallet_secret.trim()
        const secret = rawSecret.startsWith('enc:') ? decryptSecret(rawSecret) : rawSecret
        if (!secret) {
          await db.run(`UPDATE worker_payouts SET status = 'failed' WHERE id = ?`, [payoutId])
          return res.status(500).json({ error: 'decryption_failed', message: 'Unable to decrypt treasury wallet secret. Check ENCRYPTION_KEY.' })
        }
        if (secret.startsWith('[')) {
          senderKeypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret)))
        } else {
          senderKeypair = Keypair.fromSecretKey(decodeBase58(secret))
        }

        const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL)
        const tx = new SolTransaction().add(
          SystemProgram.transfer({
            fromPubkey: senderKeypair.publicKey,
            toPubkey: new PublicKey(recipientAddress),
            lamports
          })
        )
        const signature = await sendAndConfirmTransaction(conn, tx, [senderKeypair])

        // 7. Update payout record as confirmed
        await db.run(
          `UPDATE worker_payouts SET status = 'confirmed', tx_signature = ? WHERE id = ?`,
          [signature, payoutId]
        )

        // 8. Update budget spent
        await db.run(
          'UPDATE guild_wallets SET budget_spent = budget_spent + ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?',
          [amountSol, req.guild.id]
        )

        // 9. Log in worker_activity + worker_daily_stats
        const today = new Date().toISOString().slice(0, 10)
        await db.run(
          'INSERT INTO worker_activity (guild_id, discord_id, action_type, detail, amount, currency) VALUES (?, ?, ?, ?, ?, ?)',
          [req.guild.id, req.params.discordId, 'payout_received', memo || `Payroll payment of $${amountUsd.toFixed(2)} (◎${amountSol.toFixed(4)})`, amountUsd, 'USD']
        )
        await db.run(
          `INSERT INTO worker_daily_stats (guild_id, discord_id, stat_date, payout_total)
           VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, discord_id, stat_date) DO UPDATE SET payout_total = payout_total + ?`,
          [req.guild.id, req.params.discordId, today, amountSol, amountSol]
        )

        // 10. Log in activity_feed
        await db.run(
          'INSERT INTO activity_feed (guild_id, type, title, description, user_tag, amount, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [req.guild.id, 'payroll', 'Staff Paid', `Paid ${worker.username || req.params.discordId} $${amountUsd.toFixed(2)} (◎${amountSol.toFixed(4)})${memo ? ': ' + memo : ''}`, `@${req.user.username}`, amountUsd, 'USD']
        )

        // 11. Record transaction
        await db.run(
          'INSERT INTO transactions (guild_id, from_address, to_address, amount, signature, status) VALUES (?, ?, ?, ?, ?, ?)',
          [req.guild.id, guildWallet.wallet_address, recipientAddress, amountSol, signature, 'confirmed']
        )

        res.json({ ok: true, signature, amount_sol: amountSol, amount_usd: amountUsd, sol_price: solPrice, payout_id: payoutId })
      } catch (txErr) {
        // Mark payout as failed
        await db.run(`UPDATE worker_payouts SET status = 'failed' WHERE id = ?`, [payoutId])
        console.error('[payroll] TX failed:', txErr?.message || txErr)
        res.status(500).json({ error: 'transaction_failed', message: txErr?.message || 'Solana transaction failed.' })
      }
    } catch (err) {
      console.error(`[payroll] pay error at step=${step}:`, err?.message || err, err?.stack)
      res.status(500).json({ error: 'pay_failed', message: `[${step}] ${err?.message || 'Unknown error'}` })
    }
  })

  // Payroll summary — daily, weekly, monthly aggregations
  app.get('/api/admin/guilds/:guildId/payroll', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const period = req.query.period || 'all' // 'day', 'week', 'month', 'all'

      // Today / this week / this month filters
      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)
      const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7)
      const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30)

      const [todaySummary, weekSummary, monthSummary, allTime] = await Promise.all([
        db.get(
          `SELECT COUNT(*) as count, COALESCE(SUM(amount_sol), 0) as total_sol, COALESCE(SUM(amount_usd), 0) as total_usd
           FROM worker_payouts WHERE guild_id = ? AND status = 'confirmed' AND DATE(paid_at) = ?`,
          [req.guild.id, todayStr]
        ),
        db.get(
          `SELECT COUNT(*) as count, COALESCE(SUM(amount_sol), 0) as total_sol, COALESCE(SUM(amount_usd), 0) as total_usd
           FROM worker_payouts WHERE guild_id = ? AND status = 'confirmed' AND paid_at >= ?`,
          [req.guild.id, weekAgo.toISOString()]
        ),
        db.get(
          `SELECT COUNT(*) as count, COALESCE(SUM(amount_sol), 0) as total_sol, COALESCE(SUM(amount_usd), 0) as total_usd
           FROM worker_payouts WHERE guild_id = ? AND status = 'confirmed' AND paid_at >= ?`,
          [req.guild.id, monthAgo.toISOString()]
        ),
        db.get(
          `SELECT COUNT(*) as count, COALESCE(SUM(amount_sol), 0) as total_sol, COALESCE(SUM(amount_usd), 0) as total_usd
           FROM worker_payouts WHERE guild_id = ? AND status = 'confirmed'`,
          [req.guild.id]
        )
      ])

      // Per-worker breakdown for the selected period
      let dateFilter = ''
      let params = [req.guild.id]
      if (period === 'day') { dateFilter = `AND DATE(wp.paid_at) = ?`; params.push(todayStr) }
      else if (period === 'week') { dateFilter = `AND wp.paid_at >= ?`; params.push(weekAgo.toISOString()) }
      else if (period === 'month') { dateFilter = `AND wp.paid_at >= ?`; params.push(monthAgo.toISOString()) }

      const perWorker = await db.all(
        `SELECT wp.recipient_discord_id, dw.username,
           COUNT(*) as pay_count, SUM(wp.amount_sol) as total_sol, SUM(wp.amount_usd) as total_usd,
           MAX(wp.paid_at) as last_paid
         FROM worker_payouts wp
         LEFT JOIN dcb_workers dw ON wp.guild_id = dw.guild_id AND wp.recipient_discord_id = dw.discord_id
         WHERE wp.guild_id = ? AND wp.status = 'confirmed' ${dateFilter}
         GROUP BY wp.recipient_discord_id
         ORDER BY total_sol DESC`,
        params
      )

      // Daily breakdown (last 30 days)
      const dailyBreakdown = await db.all(
        `SELECT DATE(paid_at) as date, COUNT(*) as count, SUM(amount_sol) as total_sol, SUM(amount_usd) as total_usd
         FROM worker_payouts WHERE guild_id = ? AND status = 'confirmed' AND paid_at >= ?
         GROUP BY DATE(paid_at) ORDER BY date DESC`,
        [req.guild.id, monthAgo.toISOString()]
      )

      res.json({
        today: todaySummary || { count: 0, total_sol: 0, total_usd: 0 },
        week: weekSummary || { count: 0, total_sol: 0, total_usd: 0 },
        month: monthSummary || { count: 0, total_sol: 0, total_usd: 0 },
        allTime: allTime || { count: 0, total_sol: 0, total_usd: 0 },
        perWorker: perWorker || [],
        dailyBreakdown: dailyBreakdown || []
      })
    } catch (err) {
      console.error('[payroll] summary error:', err?.message || err)
      res.status(500).json({ error: 'payroll_summary_failed' })
    }
  })

  // Payroll history — detailed list of all payouts
  app.get('/api/admin/guilds/:guildId/payroll/history', requireAuth, requireGuildMember, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500)
      const rows = await db.all(
        `SELECT wp.*, dw.username as recipient_username
         FROM worker_payouts wp
         LEFT JOIN dcb_workers dw ON wp.guild_id = dw.guild_id AND wp.recipient_discord_id = dw.discord_id
         WHERE wp.guild_id = ?
         ORDER BY wp.paid_at DESC LIMIT ?`,
        [req.guild.id, limit]
      )
      res.json(rows || [])
    } catch (err) {
      console.error('[payroll] history error:', err?.message || err)
      res.status(500).json({ error: 'payroll_history_failed' })
    }
  })

  app.get('/api/admin/guilds/:guildId/members', requireAuth, requireGuildMember, async (req, res) => {
    try {
      let list = []
      if (typeof req.guild.members?.fetch === 'function') {
        const members = await req.guild.members.fetch({ limit: 100 })
        list = members.filter(m => !m.user.bot).map(m => ({
          id: m.id, username: m.user.username, display_name: m.displayName, avatar: m.user.displayAvatarURL({ size: 32 })
        }))
      } else {
        // REST-only fallback
        try {
          const members = await discordBotAPI(`/guilds/${req.params.guildId}/members?limit=100`)
          list = members.filter(m => !m.user?.bot).map(m => ({
            id: m.user.id,
            username: m.user.username,
            display_name: m.nick || m.user.global_name || m.user.username,
            avatar: m.user.avatar ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=32` : null
          }))
        } catch (restErr) {
          console.warn('[members] REST fallback failed:', restErr?.message)
        }
      }
      res.json(list)
    } catch (err) {
      console.error('[members] GET error:', err?.message || err)
      res.status(500).json({ error: 'failed_to_list_members' })
    }
  })

  // ---- Internal API: Bot → Backend activity sync ----
  const INTERNAL_SECRET = process.env.DCB_INTERNAL_SECRET
  const requireInternal = (req, res, next) => {
    if (!INTERNAL_SECRET) return res.status(503).json({ error: 'internal_api_not_configured' })
    const provided = req.headers['x-dcb-internal-secret']
    if (provided !== INTERNAL_SECRET) return res.status(403).json({ error: 'forbidden' })
    next()
  }

  // Bot pushes every command execution here
  app.post('/api/internal/log-command', requireInternal, async (req, res) => {
    try {
      const { guildId, discordId, commandName, channelId, username } = req.body || {}
      if (!guildId || !discordId || !commandName) return res.status(400).json({ error: 'missing_fields' })

      // Log to command_audit (always, regardless of worker status)
      await db.run(
        'INSERT INTO command_audit (discord_id, guild_id, command_name) VALUES (?, ?, ?)',
        [discordId, guildId, commandName]
      ).catch(() => {})

      // Check if user is a DCB worker in THIS (backend) database
      const worker = await db.get(
        'SELECT * FROM dcb_workers WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL',
        [guildId, discordId]
      )
      if (worker) {
        const today = new Date().toISOString().slice(0, 10)
        // Log activity
        await db.run(
          'INSERT INTO worker_activity (guild_id, discord_id, action_type, detail, channel_id) VALUES (?, ?, ?, ?, ?)',
          [guildId, discordId, 'command', `/${commandName}`, channelId || null]
        )
        // Upsert daily stat
        await db.run(
          `INSERT INTO worker_daily_stats (guild_id, discord_id, stat_date, commands_run)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(guild_id, discord_id, stat_date)
           DO UPDATE SET commands_run = commands_run + 1`,
          [guildId, discordId, today]
        )
        // Track payout commands specifically
        if (['pay', 'task-approve', 'approve-proof'].includes(commandName)) {
          await db.run(
            `INSERT INTO worker_daily_stats (guild_id, discord_id, stat_date, payouts_issued)
             VALUES (?, ?, ?, 1)
             ON CONFLICT(guild_id, discord_id, stat_date)
             DO UPDATE SET payouts_issued = payouts_issued + 1`,
            [guildId, discordId, today]
          )
        }
        console.log(`[internal] Logged command /${commandName} for worker ${discordId} in guild ${guildId}`)
      } else {
        console.log(`[internal] Command /${commandName} by ${discordId} in ${guildId} (not a worker, audit only)`)
      }

      res.json({ ok: true, isWorker: !!worker })
    } catch (err) {
      console.error('[internal] log-command error:', err?.message || err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // Bot pushes message activity here
  app.post('/api/internal/log-message', requireInternal, async (req, res) => {
    try {
      const { guildId, discordId } = req.body || {}
      if (!guildId || !discordId) return res.status(400).json({ error: 'missing_fields' })
      const worker = await db.get(
        'SELECT * FROM dcb_workers WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL',
        [guildId, discordId]
      )
      if (worker) {
        const today = new Date().toISOString().slice(0, 10)
        await db.run(
          `INSERT INTO worker_daily_stats (guild_id, discord_id, stat_date, messages_sent)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(guild_id, discord_id, stat_date)
           DO UPDATE SET messages_sent = messages_sent + 1`,
          [guildId, discordId, today]
        )
      }
      res.json({ ok: true })
    } catch (err) {
      console.error('[internal] log-message error:', err?.message || err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // Bot pushes online time here
  app.post('/api/internal/log-online-time', requireInternal, async (req, res) => {
    try {
      const { guildId, discordId, minutes } = req.body || {}
      if (!guildId || !discordId || !minutes) return res.status(400).json({ error: 'missing_fields' })
      const worker = await db.get(
        'SELECT * FROM dcb_workers WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL',
        [guildId, discordId]
      )
      if (worker) {
        const today = new Date().toISOString().slice(0, 10)
        await db.run(
          `INSERT INTO worker_daily_stats (guild_id, discord_id, stat_date, online_minutes)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(guild_id, discord_id, stat_date)
           DO UPDATE SET online_minutes = online_minutes + ?`,
          [guildId, discordId, today, minutes, minutes]
        )
      }
      res.json({ ok: true })
    } catch (err) {
      console.error('[internal] log-online-time error:', err?.message || err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // Bot pushes event creation here
  app.post('/api/internal/log-event-created', requireInternal, async (req, res) => {
    try {
      const { guildId, discordId, detail, channelId } = req.body || {}
      if (!guildId || !discordId) return res.status(400).json({ error: 'missing_fields' })
      const worker = await db.get(
        'SELECT * FROM dcb_workers WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL',
        [guildId, discordId]
      )
      if (worker) {
        const today = new Date().toISOString().slice(0, 10)
        await db.run(
          'INSERT INTO worker_activity (guild_id, discord_id, action_type, detail, channel_id) VALUES (?, ?, ?, ?, ?)',
          [guildId, discordId, 'event_created', detail || 'Created event', channelId || null]
        )
        await db.run(
          `INSERT INTO worker_daily_stats (guild_id, discord_id, stat_date, events_created)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(guild_id, discord_id, stat_date)
           DO UPDATE SET events_created = events_created + 1`,
          [guildId, discordId, today]
        )
      }
      res.json({ ok: true })
    } catch (err) {
      console.error('[internal] log-event-created error:', err?.message || err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // Bot fetches gambling-event data it doesn't have locally (created via web UI)
  app.get('/api/internal/gambling-event/:id', requireInternal, async (req, res) => {
    try {
      const eventId = Number(req.params.id)
      const event = await db.get('SELECT * FROM gambling_events WHERE id = ?', [eventId])
      if (!event) return res.status(404).json({ error: 'not_found' })
      const slots = await db.all('SELECT * FROM gambling_event_slots WHERE gambling_event_id = ? ORDER BY slot_number ASC', [eventId])
      res.json({ event, slots })
    } catch (err) {
      console.error('[internal] gambling-event fetch error:', err?.message || err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // Bot pushes gambling bet/status back to keep backend DB in sync
  app.post('/api/internal/gambling-event-sync', requireInternal, async (req, res) => {
    try {
      const { eventId, action, userId, guildId, chosenSlot, slotNumber, betAmount, paymentStatus, walletAddress, status } = req.body || {}
      if (!eventId) return res.status(400).json({ error: 'missing_eventId' })
      // Accept both chosenSlot and slotNumber (bot sends slotNumber)
      const slot = chosenSlot || slotNumber

      if (action === 'bet' && userId && guildId) {
        await db.run(
          `INSERT OR IGNORE INTO gambling_event_bets (gambling_event_id, guild_id, user_id, chosen_slot, bet_amount, payment_status, wallet_address) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [eventId, guildId, userId, slot, betAmount || 0, paymentStatus || 'none', walletAddress || null]
        ).catch(() => {})
        await db.run(
          `UPDATE gambling_events SET current_players = (SELECT COUNT(*) FROM gambling_event_bets WHERE gambling_event_id = ?) WHERE id = ?`,
          [eventId, eventId]
        ).catch(() => {})
      } else if (action === 'qualify' && userId) {
        const { screenshotUrl } = req.body || {}
        const username = req.body?.username || userId
        await db.run(
          `INSERT OR REPLACE INTO gambling_event_qualifications (gambling_event_id, user_id, username, screenshot_url, status, submitted_at) VALUES (?, ?, ?, ?, 'approved', datetime('now'))`,
          [eventId, userId, username, screenshotUrl || '']
        ).catch(() => {})
      } else if (action === 'status_update' && status) {
        await db.run(
          `UPDATE gambling_events SET status = ? WHERE id = ?`,
          [status, eventId]
        ).catch(() => {})
        console.log(`[internal] gambling-event #${eventId} status → ${status}`)
      }

      res.json({ ok: true })
    } catch (err) {
      console.error('[internal] gambling-event-sync error:', err?.message || err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // Bot fetches vote-event data it doesn't have locally (created via web UI)
  app.get('/api/internal/vote-event/:id', requireInternal, async (req, res) => {
    try {
      const eventId = Number(req.params.id)
      const event = await db.get('SELECT * FROM vote_events WHERE id = ?', [eventId])
      if (!event) return res.status(404).json({ error: 'not_found' })
      const images = await db.all('SELECT * FROM vote_event_images WHERE vote_event_id = ? ORDER BY upload_order ASC', [eventId])
      res.json({ event, images })
    } catch (err) {
      console.error('[internal] vote-event fetch error:', err?.message || err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // Bot pushes participant join/vote back to keep backend DB in sync
  app.post('/api/internal/vote-event-sync', requireInternal, async (req, res) => {
    try {
      const { eventId, action, userId, guildId, votedImageId, screenshotUrl } = req.body || {}
      if (!eventId) return res.status(400).json({ error: 'missing_eventId' })

      if (action === 'join' && userId && guildId) {
        await db.run(
          `INSERT OR IGNORE INTO vote_event_participants (vote_event_id, guild_id, user_id) VALUES (?, ?, ?)`,
          [eventId, guildId, userId]
        ).catch(() => {})
        await db.run(
          `UPDATE vote_events SET current_participants = (SELECT COUNT(*) FROM vote_event_participants WHERE vote_event_id = ?) WHERE id = ?`,
          [eventId, eventId]
        ).catch(() => {})
      } else if (action === 'vote' && userId && votedImageId) {
        await db.run(
          `UPDATE vote_event_participants SET voted_image_id = ?, voted_at = datetime('now') WHERE vote_event_id = ? AND user_id = ?`,
          [votedImageId, eventId, userId]
        ).catch(() => {})
      } else if (action === 'qualify' && userId && screenshotUrl) {
        await db.run(
          `INSERT OR REPLACE INTO vote_event_qualifications (vote_event_id, user_id, username, screenshot_url, status, submitted_at) VALUES (?, ?, '', ?, 'approved', datetime('now'))`,
          [eventId, userId, screenshotUrl]
        ).catch(() => {})
      } else if (action === 'status_update' && req.body.status) {
        await db.run(
          `UPDATE vote_events SET status = ? WHERE id = ?`,
          [req.body.status, eventId]
        ).catch(() => {})
        console.log(`[internal] vote-event #${eventId} status → ${req.body.status}`)
      }

      res.json({ ok: true })
    } catch (err) {
      console.error('[internal] vote-event-sync error:', err?.message || err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // Bot pushes payout details here
  app.post('/api/internal/log-payout', requireInternal, async (req, res) => {
    try {
      const { guildId, discordId, amount, currency, detail, channelId } = req.body || {}
      if (!guildId || !discordId) return res.status(400).json({ error: 'missing_fields' })

      const worker = await db.get(
        'SELECT * FROM dcb_workers WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL',
        [guildId, discordId]
      )
      if (worker) {
        const today = new Date().toISOString().slice(0, 10)
        await db.run(
          'INSERT INTO worker_activity (guild_id, discord_id, action_type, detail, amount, currency, channel_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [guildId, discordId, 'payout', detail || 'payout', amount || 0, currency || 'SOL', channelId || null]
        )
        await db.run(
          `INSERT INTO worker_daily_stats (guild_id, discord_id, stat_date, payout_total)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(guild_id, discord_id, stat_date)
           DO UPDATE SET payout_total = payout_total + ?`,
          [guildId, discordId, today, amount || 0, amount || 0]
        )
      }
      res.json({ ok: true })
    } catch (err) {
      console.error('[internal] log-payout error:', err?.message || err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // ── Internal Wallet Sync (bot pulls / pushes wallet data) ──────

  // Bot pushes user wallet connect/update to backend DB
  app.post('/api/internal/user-wallet-sync', requireInternal, async (req, res) => {
    try {
      const { discordId, solanaAddress, username } = req.body || {}
      if (!discordId || !solanaAddress) return res.status(400).json({ error: 'missing_fields' })

      await db.run(
        `INSERT INTO user_wallets (discord_id, solana_address, username, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(discord_id) DO UPDATE SET
           solana_address = excluded.solana_address,
           username = excluded.username,
           updated_at = CURRENT_TIMESTAMP`,
        [discordId, solanaAddress, username || null]
      )
      console.log(`[internal] user-wallet synced for ${discordId}: ${solanaAddress.slice(0,8)}...`)
      res.json({ ok: true })
    } catch (err) {
      console.error('[internal] user-wallet-sync error:', err?.message)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // Bot pulls wallet from backend DB (authoritative when set via web UI)
  app.get('/api/internal/guild-wallet/:guildId', requireInternal, async (req, res) => {
    try {
      const wallet = await db.get('SELECT * FROM guild_wallets WHERE guild_id = ?', [req.params.guildId])
      res.json({ wallet: wallet || null })
    } catch (err) {
      console.error('[internal] guild-wallet GET error:', err?.message)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // Bot pushes wallet connect/update to backend DB
  app.post('/api/internal/guild-wallet-sync', requireInternal, async (req, res) => {
    try {
      const { guildId, action, wallet_address, label, network, configured_by, wallet_secret } = req.body || {}
      if (!guildId) return res.status(400).json({ error: 'missing_guild_id' })

      if (action === 'disconnect') {
        await db.run('DELETE FROM guild_wallets WHERE guild_id = ?', [guildId])
        console.log(`[internal] wallet disconnected for guild ${guildId}`)
        return res.json({ ok: true })
      }

      if (!wallet_address) return res.status(400).json({ error: 'missing_wallet_address' })

      // Properly handle incoming secrets: strip transport layer, avoid double-encrypting
      let secretToStore = wallet_secret || null
      if (secretToStore) {
        // Strip E2E transport layer if present (bot sends e2e-wrapped at-rest encrypted values)
        if (isTransportEncrypted(secretToStore)) {
          secretToStore = decryptTransport(secretToStore)
        }
        // If already at-rest encrypted (enc:...), store as-is; otherwise encrypt
        if (secretToStore && !isEncryptedValue(secretToStore)) {
          secretToStore = encryptSecret(secretToStore)
        }
      }

      await db.run(
        `INSERT INTO guild_wallets (guild_id, wallet_address, configured_by, label, network, wallet_secret, configured_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(guild_id) DO UPDATE SET
           wallet_address = excluded.wallet_address,
           configured_by = excluded.configured_by,
           label = excluded.label,
           network = excluded.network,
           wallet_secret = excluded.wallet_secret,
           updated_at = CURRENT_TIMESTAMP`,
        [guildId, wallet_address, configured_by || null, label || 'Treasury', network || 'mainnet-beta', secretToStore]
      )
      console.log(`[internal] wallet synced for guild ${guildId}: ${wallet_address.slice(0,8)}...`)
      res.json({ ok: true })
    } catch (err) {
      console.error('[internal] guild-wallet-sync error:', err?.message)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // ══════════════════════════════════════════════════════════════════
  //  PUBLIC STATS — website ticker (no auth required)
  // ══════════════════════════════════════════════════════════════════

  /** safe wrapper – returns fallback on DB error so one bad query doesn't sink the whole response */
  async function safe(promise, fallback = null) {
    try { return await promise; } catch (e) { console.warn('[stats] query failed:', e.message); return fallback; }
  }

  app.get('/api/stats', async (_req, res) => {
    try {
      // Run all aggregation queries in parallel for speed
      const [
        txRow,
        contestRow, voteEventRow, eventRow,
        bulkTaskRow, taskRow,
        paidTx,
        prizePoolSOL, prizePoolUSD,
        contestWinners, voteWinners, proofPayouts,
        usersRow,
        treasuryWalletCount, userWalletCount,
        siteVisitors, totalCommandsRun, managerClicks,
        payWalletCommands
      ] = await Promise.all([
        safe(db.get('SELECT COUNT(*) AS c FROM transactions'), { c: 0 }),
        safe(db.get('SELECT COUNT(*) AS c FROM contests'), { c: 0 }),
        safe(db.get('SELECT COUNT(*) AS c FROM vote_events'), { c: 0 }),
        safe(db.get('SELECT COUNT(*) AS c FROM events'), { c: 0 }),
        safe(db.get('SELECT COUNT(*) AS c FROM bulk_tasks'), { c: 0 }),
        safe(db.get('SELECT COUNT(*) AS c FROM tasks'), { c: 0 }),
        // On-chain transactions (direct SOL transfers)
        safe(db.get('SELECT COALESCE(SUM(amount), 0) AS total FROM transactions'), { total: 0 }),
        // Total prize pool offered (SOL-denominated events)
        safe(db.get(`SELECT COALESCE(SUM(prize_amount), 0) AS total FROM (
          SELECT prize_amount FROM vote_events WHERE currency = 'SOL' AND prize_amount > 0
          UNION ALL SELECT prize_amount FROM contests WHERE currency = 'SOL' AND prize_amount > 0
          UNION ALL SELECT prize_amount FROM events WHERE currency = 'SOL' AND prize_amount > 0
          UNION ALL SELECT payout_amount AS prize_amount FROM bulk_tasks WHERE payout_currency = 'SOL' AND payout_amount > 0
        )`), { total: 0 }),
        // Total prize pool offered (USD-denominated events)
        safe(db.get(`SELECT COALESCE(SUM(prize_amount), 0) AS total FROM (
          SELECT prize_amount FROM vote_events WHERE currency = 'USD' AND prize_amount > 0
          UNION ALL SELECT prize_amount FROM contests WHERE currency = 'USD' AND prize_amount > 0
          UNION ALL SELECT prize_amount FROM events WHERE currency = 'USD' AND prize_amount > 0
          UNION ALL SELECT payout_amount AS prize_amount FROM bulk_tasks WHERE payout_currency = 'USD' AND payout_amount > 0
        )`), { total: 0 }),
        safe(db.get("SELECT COUNT(*) AS c FROM contest_entries WHERE is_winner = 1"), { c: 0 }),
        safe(db.get("SELECT COUNT(*) AS c FROM vote_event_participants WHERE is_winner = 1"), { c: 0 }),
        safe(db.get("SELECT COUNT(*) AS c FROM proof_submissions WHERE status = 'approved'"), { c: 0 }),
        safe(db.get('SELECT COUNT(*) AS c FROM users'), { c: 0 }),
        // Wallet counts
        safe(db.get('SELECT COUNT(*) AS c FROM guild_wallets WHERE wallet_address IS NOT NULL'), { c: 0 }),
        safe(db.get("SELECT COUNT(*) AS c FROM users WHERE solana_address IS NOT NULL"), { c: 0 }),
        safe(db.get("SELECT count FROM site_analytics WHERE metric = 'site_visitors'"), { count: 0 }),
        safe(db.get('SELECT COUNT(*) AS c FROM command_audit'), { c: 0 }),
        safe(db.get("SELECT count FROM site_analytics WHERE metric = 'manager_clicks'"), { count: 0 }),
        safe(db.get("SELECT COUNT(*) AS c FROM command_audit WHERE command_name IN ('pay', 'wallet', 'user-wallet', 'bot-wallet')"), { c: 0 }),
      ]);

      // Active servers = actual Discord guilds the bot is in (live count)
      const activeServers = discordClient?.guilds?.cache?.size || 0;

      // Prize pool raw values (computed after solPrice is fetched below)
      const txSOL = paidTx.total || 0;
      const poolSOL = prizePoolSOL.total || 0;
      const poolUSD = prizePoolUSD.total || 0;

      // ── Inline Solana helpers (utils/crypto not available in backend container) ──
      const LAMPORTS_PER_SOL = 1_000_000_000;
      const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

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
        const treasuryWallets = await safe(db.all('SELECT wallet_address FROM guild_wallets WHERE wallet_address IS NOT NULL'), []);
        const treasuryBalances = await Promise.all(
          treasuryWallets.map(w => fetchSolBalance(w.wallet_address))
        );
        treasuryBalanceSOL = treasuryBalances.reduce((s, b) => s + b, 0);

        // User wallets (bot DB uses solana_address)
        const userWallets = await safe(db.all("SELECT solana_address AS addr FROM users WHERE solana_address IS NOT NULL"), []);
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
        voteEventsCreated: voteEventRow.c || 0,
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

  // ── Temporary debug: inspect payout data sources ────────────────────
  app.get('/api/debug/payouts', async (_req, res) => {
    try {
      const [voteEvents, voteParticipants, contests, contestEntries, transactions, tasks, proofSubs] = await Promise.all([
        safe(db.all('SELECT id, title, prize_amount, currency, status FROM vote_events'), []),
        safe(db.all('SELECT vote_event_id, user_id, is_winner FROM vote_event_participants'), []),
        safe(db.all('SELECT id, title, prize_amount, currency, status, num_winners FROM contests'), []),
        safe(db.all('SELECT contest_id, user_id, is_winner FROM contest_entries'), []),
        safe(db.all('SELECT id, guild_id, amount, status FROM transactions'), []),
        safe(db.all('SELECT id, guild_id, amount, status, transaction_signature FROM tasks'), []),
        safe(db.all("SELECT ps.id, ps.status, bt.payout_amount, bt.payout_currency FROM proof_submissions ps JOIN task_assignments ta ON ps.task_assignment_id = ta.id JOIN bulk_tasks bt ON ta.bulk_task_id = bt.id"), []),
      ]);
      res.json({ voteEvents, voteParticipants, contests, contestEntries, transactions, tasks, proofSubs });
    } catch (err) {
      res.status(500).json({ error: err.message });
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
      await db.run(
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

  // Global error handler — prevents unhandled errors from crashing the server
  app.use((err, req, res, _next) => {
    console.error('[express] Unhandled error:', err?.message || err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_server_error' })
    }
  })

  // ── BULK WALLET SYNC FROM BOT ─────────────────────────────────
  // On startup (and every 10 min), pull all user wallets from the bot
  async function syncAllWalletsFromBot() {
    const BOT_API_URL = process.env.DCB_BOT_API_URL || process.env.BOT_API_URL || ''
    if (!BOT_API_URL) {
      console.warn('[wallet-sync] DCB_BOT_API_URL not set, skipping bulk wallet sync')
      return
    }
    try {
      const _syncAc = new AbortController(); const _syncTo = setTimeout(() => _syncAc.abort(), 15000)
      const res = await fetch(`${BOT_API_URL.replace(/\/$/, '')}/api/internal/user-wallets`, {
        headers: { 'x-dcb-internal-secret': process.env.DCB_INTERNAL_SECRET || '' },
        signal: _syncAc.signal
      })
      clearTimeout(_syncTo)
      if (!res.ok) {
        console.warn(`[wallet-sync] Bot returned ${res.status}`)
        return
      }
      const rows = await res.json()
      if (!Array.isArray(rows)) return
      let synced = 0
      for (const row of rows) {
        if (!row.discord_id || !row.solana_address) continue
        await db.run(
          `INSERT INTO user_wallets (discord_id, solana_address, username, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(discord_id) DO UPDATE SET solana_address = excluded.solana_address, updated_at = CURRENT_TIMESTAMP`,
          [row.discord_id, row.solana_address, row.username || null]
        )
        synced++
      }
      console.log(`[wallet-sync] Synced ${synced} wallets from bot (${rows.length} total)`)
    } catch (err) {
      console.warn('[wallet-sync] Bulk sync failed:', err?.message || err)
    }
  }

  // Run immediately (async, don't block startup)
  setTimeout(() => syncAllWalletsFromBot(), 5000)
  // Repeat every 10 minutes
  setInterval(() => syncAllWalletsFromBot(), 10 * 60 * 1000)

  // ---- Migrate existing plaintext secrets to encrypted form ----
  setTimeout(async () => {
    const key = process.env.ENCRYPTION_KEY
    if (!key || key.length !== 64) {
      console.log('[BACKEND-MIGRATE] ENCRYPTION_KEY not set — skipping secret migration')
      return
    }
    try {
      const rows = await db.all('SELECT guild_id, wallet_secret FROM guild_wallets WHERE wallet_secret IS NOT NULL')
      let migrated = 0
      for (const row of rows) {
        if (row.wallet_secret && !row.wallet_secret.startsWith('enc:')) {
          const encrypted = encryptSecret(row.wallet_secret)
          if (encrypted !== row.wallet_secret) {
            await db.run('UPDATE guild_wallets SET wallet_secret = ? WHERE guild_id = ?', [encrypted, row.guild_id])
            migrated++
            console.log(`[BACKEND-MIGRATE] Encrypted guild wallet secret for guild ${row.guild_id}`)
          }
        }
      }
      console.log(`[BACKEND-MIGRATE] Migration complete. ${migrated} secrets encrypted.`)
    } catch (err) {
      console.error('[BACKEND-MIGRATE] Migration error:', err?.message || err)
    }
  }, 3000)

  return app
}
