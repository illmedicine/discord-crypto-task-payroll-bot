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
      const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId)
      if (!guild) return res.status(404).json({ error: 'guild_not_found' })
      const discordId = await resolveCanonicalUserId(req.user)
      if (!discordId) {
        console.warn(`[requireGuildOwner] No discordId resolved for user:`, req.user?.id)
        return res.status(403).json({ error: 'forbidden_not_guild_owner' })
      }
      // Check ownership via bot cache first
      if (discordId === guild.ownerId) {
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
        console.warn(`[requireGuildOwner] No OAuth guilds available for user ${discordId}`)
      }
      return res.status(403).json({ error: 'forbidden_not_guild_owner' })
    } catch (err) {
      console.error(`[requireGuildOwner] Guild fetch failed:`, err?.message)
      return res.status(404).json({ error: 'guild_not_found' })
    }
  }

  // Like requireGuildOwner but allows any guild member (for read-only endpoints)
  async function requireGuildMember(req, res, next) {
    try {
      const guildId = req.params.guildId || req.body.guild_id || req.query.guild_id
      if (!guildId) return res.status(400).json({ error: 'missing_guild_id' })
      const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId)
      if (!guild) return res.status(404).json({ error: 'guild_not_found' })
      const discordId = await resolveCanonicalUserId(req.user)
      if (!discordId) {
        console.warn(`[requireGuildMember] No discordId resolved for user:`, req.user?.id)
        return res.status(403).json({ error: 'forbidden_no_discord_id' })
      }
      // Owner always passes
      if (discordId === guild.ownerId) {
        req.guild = guild
        req.userRole = 'owner'
        return next()
      }
      // Check if user is a guild member via bot cache
      try {
        const member = await guild.members.fetch(discordId)
        req.guild = guild
        // Detect admin even via bot cache
        const hasAdmin = member.permissions.has('Administrator') || member.permissions.has('ManageGuild')
        req.userRole = hasAdmin ? 'admin' : 'member'
        return next()
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
        console.warn(`[requireGuildMember] User ${discordId} denied access to guild ${guildId} (owner: ${guild.ownerId})`)
        return res.status(403).json({ error: 'forbidden_not_guild_member' })
      }
    } catch (err) {
      console.error(`[requireGuildMember] Guild fetch failed:`, err?.message)
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
          results.push({
            id: ug.id,
            name: ug.name,
            role: isOwner ? 'owner' : isAdmin ? 'admin' : 'member'
          })
        }
      }
    } else {
      // Fallback: iterate bot's guild cache (original approach)
      for (const g of discordClient.guilds.cache.values()) {
        try {
          const guild = await g.fetch()
          if (guild.ownerId === discordId) {
            results.push({ id: guild.id, name: guild.name, role: 'owner' })
          } else if (discordId) {
            try {
              await guild.members.fetch(discordId)
              results.push({ id: guild.id, name: guild.name, role: 'member' })
            } catch (_) { /* not a member */ }
          }
        } catch (_) {
        }
      }
    }
    res.json(results)
  })

  app.get('/api/admin/guilds/:guildId/channels', requireAuth, requireGuildMember, async (req, res) => {
    const channels = await req.guild.channels.fetch()
    const out = []
    for (const c of channels.values()) {
      if (c && (c.type === 0 || c.type === 5)) out.push({ id: c.id, name: c.name, type: c.type })
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    res.json(out)
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
          const channel = await discordClient.channels.fetch(event.channel_id)
          if (channel) {
            const msg = await channel.messages.fetch(event.message_id)
            if (msg) await msg.delete()
          }
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
          const channel = await discordClient.channels.fetch(event.channel_id)
          if (channel) {
            const msg = await channel.messages.fetch(event.message_id)
            if (msg) await msg.delete()
          }
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
          const channel = await discordClient.channels.fetch(event.channel_id)
          if (channel && 'send' in channel) {
            const { AttachmentBuilder } = require('discord.js')
            const att = new AttachmentBuilder(req.file.buffer, { name: req.file.originalname || 'screenshot.png' })
            const msg = await channel.send({
              content: `📸 Qualification proof from **${username}** for event **${event.title}**`,
              files: [att]
            })
            if (msg.attachments.size > 0) {
              screenshotUrl = msg.attachments.first().url
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

  app.get('/api/admin/guilds/:guildId/members', requireAuth, requireGuildMember, async (req, res) => {
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

  return app
}
