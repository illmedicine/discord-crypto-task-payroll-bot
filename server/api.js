const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cors = require('cors');

module.exports = (client) => {
  const app = express();
  const port = process.env.PORT || 3000;

  app.use(express.json());
  app.use(cookieParser());

  // CORS - allow frontend origin and allow credentials
  const allowedOrigin = process.env.DCB_API_BASE || '*';
  app.use(cors({ origin: allowedOrigin === '*' ? true : allowedOrigin, credentials: true }));

  // Basic health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Helper to compute base url for redirect URIs
  function baseUrl(req) {
    if (process.env.DCB_API_BASE) return process.env.DCB_API_BASE.replace(/\/$/, '');
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    return `${proto}://${req.get('host')}`;
  }

  const SESSION_SECRET = process.env.DCB_SESSION_SECRET || 'change-this-secret';
  const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

  // Start Discord OAuth - redirect to Discord authorize URL
  app.get('/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId) return res.status(500).send('DISCORD_CLIENT_ID not configured');

    const state = crypto.randomBytes(12).toString('hex');
    res.cookie('dcb_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });

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
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_TTL_SECONDS * 1000
      });

      res.clearCookie('dcb_oauth_state');

      // Redirect back to UI (if configured) or show success page
      const uiBase = process.env.DCB_API_BASE ? process.env.DCB_API_BASE : null;
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

  // Mount minimal API endpoints used by the front-end (optional placeholders)
  app.get('/api/contests', (req, res) => {
    res.json([]);
  });

  // Start listening
  app.listen(port, () => {
    console.log(`[API] Server listening on port ${port}`);
  });

  return app;
};
