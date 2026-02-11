const { Client, GatewayIntentBits } = require('discord.js')
const buildApi = require('./api')

if (!process.env.DCB_SESSION_SECRET) {
  throw new Error('DCB_SESSION_SECRET is required')
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences]
})

client.once('ready', () => {
  const port = process.env.PORT || 3000
  const app = buildApi({ discordClient: client })
  app.listen(port, () => {
    console.log(`[backend] listening on ${port}`)
  })
})

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('[backend] discord login failed:', err?.message || err)
  const port = process.env.PORT || 3000
  const app = buildApi({ discordClient: client })
  app.listen(port, () => {
    console.log(`[backend] listening on ${port} (discord offline)`)
  })
})
