const { Client, GatewayIntentBits } = require('discord.js')
const buildApi = require('./api')

if (!process.env.DCB_SESSION_SECRET) {
  throw new Error('DCB_SESSION_SECRET is required')
}

// IMPORTANT: Use REST-only mode — do NOT connect to Discord Gateway.
// The bot process (index.js) is the sole gateway client.
// If the backend also connects via gateway with the same token, Discord
// routes interactions randomly between the two clients, causing:
//   - "This interaction failed" (backend has no handlers)
//   - Duplicate messages
//   - Session invalidation loops
//
// We create a Client but set the token manually for REST-only API calls
// (channels.fetch, guilds.fetch, etc.) without opening a gateway connection.
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
})

// Set token for REST API calls without connecting to gateway
client.token = process.env.DISCORD_TOKEN
client.rest.setToken(process.env.DISCORD_TOKEN)

// Populate guild cache via REST (replaces gateway-based cache)
async function populateGuildCache() {
  try {
    let allGuilds = []
    let after = '0'
    while (true) {
      const res = await fetch(`https://discord.com/api/v10/users/@me/guilds?limit=200&after=${after}`, {
        headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const guilds = await res.json()
      if (guilds.length === 0) break
      allGuilds = allGuilds.concat(guilds)
      after = guilds[guilds.length - 1].id
      if (guilds.length < 200) break
    }
    console.log(`[backend] Fetched ${allGuilds.length} guilds via REST`)
    for (const g of allGuilds) {
      if (!client.guilds.cache.has(g.id)) {
        client.guilds.cache.set(g.id, {
          id: g.id,
          name: g.name,
          ownerId: null,
          icon: g.icon,
          fetch: async () => client.guilds.fetch(g.id)
        })
      }
    }
  } catch (err) {
    console.warn('[backend] Could not populate guild cache via REST:', err?.message)
  }
}

async function startServer() {
  // Validate encryption environment at startup
  const encKey = process.env.ENCRYPTION_KEY
  const e2eKey = process.env.E2E_TRANSPORT_KEY
  if (!encKey) {
    console.warn('[ENCRYPTION] ⚠️  ENCRYPTION_KEY not set — private keys stored in plaintext')
    console.warn('[ENCRYPTION]    Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  } else if (encKey.length !== 64) {
    console.error('[ENCRYPTION] ❌ ENCRYPTION_KEY invalid (need 64 hex chars, got ' + encKey.length + ')')
  } else {
    console.log('[ENCRYPTION] ✅ ENCRYPTION_KEY configured')
  }
  if (e2eKey && e2eKey.length === 64) {
    console.log('[ENCRYPTION] ✅ E2E_TRANSPORT_KEY configured (separate transit key)')
  } else if (!e2eKey) {
    console.log('[ENCRYPTION] ℹ️  E2E_TRANSPORT_KEY not set — using ENCRYPTION_KEY for transit')
  }

  await populateGuildCache()
  const port = process.env.PORT || 3000
  const app = buildApi({ discordClient: client })
  app.listen(port, () => {
    console.log(`[backend] listening on ${port} (REST-only mode, no gateway)`)
  })

  // Refresh guild cache periodically (every 5 minutes)
  setInterval(populateGuildCache, 5 * 60 * 1000)
}

startServer().catch(err => {
  console.error('[backend] startup error:', err?.message || err)
  const port = process.env.PORT || 3000
  const app = buildApi({ discordClient: client })
  app.listen(port, () => {
    console.log(`[backend] listening on ${port} (REST-only, guild cache failed)`)
  })
})
