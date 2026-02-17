const { Client, GatewayIntentBits } = require('discord.js')
const buildApi = require('./api')

if (!process.env.DCB_SESSION_SECRET) {
  throw new Error('DCB_SESSION_SECRET is required')
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences]
})

// Forward any interactions we receive to avoid "This interaction failed"
// The bot process (index.js) is the primary interaction handler.
// This backend client may receive interactions because it shares the same token.
client.on('interactionCreate', async (interaction) => {
  console.log(`[backend] Received interaction (type=${interaction.type}, customId=${interaction.customId || 'N/A'}) — backend does not handle interactions, acknowledging to prevent failure`)
  try {
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferUpdate().catch(() => {})
      }
    } else if (interaction.isChatInputCommand()) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '⏳ Processing... please try again in a moment.', ephemeral: true }).catch(() => {})
      }
    }
  } catch (_) {}
})

client.once('ready', () => {
  console.log(`[backend] Discord client ready as ${client.user?.tag}`)
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
