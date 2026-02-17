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
    const res = await fetch('https://discord.com/api/v10/users/@me/guilds?limit=200', {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const guilds = await res.json()
    console.log(`[backend] Fetched ${guilds.length} guilds via REST`)
    for (const g of guilds) {
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
