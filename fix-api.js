const fs = require('fs');
const path = 'apps/backend/src/api.js';
let content = fs.readFileSync(path, 'utf8');

const normalizeFunc = `
  // Normalize a raw Discord API message to have discord.js-compatible attachment Map
  function _normalizeRESTMessage(msg) {
    if (!msg) return msg
    if (Array.isArray(msg.attachments)) {
      const arr = msg.attachments.map(a => [a.id, {
        ...a,
        contentType: a.content_type || a.contentType,
        proxyURL: a.proxy_url || a.proxyURL,
        name: a.filename || a.name,
      }])
      const attMap = new Map(arr)
      attMap.first = function() { return this.values().next().value }
      msg.attachments = attMap
    }
    msg.author = msg.author || {}
    if (!msg.author.tag && msg.author.username) {
      msg.author.tag = msg.author.discriminator && msg.author.discriminator !== '0'
        ? \`\${msg.author.username}#\${msg.author.discriminator}\` : msg.author.username
    }
    msg.createdAt = msg.timestamp ? new Date(msg.timestamp) : new Date()
    return msg
  }

  // Fetch a text channel and return a wrapper with send/messages.fetch that works in REST-only mode`;

content = content.replace('  // Fetch a text channel and return a wrapper with send/messages.fetch that works in REST-only mode', normalizeFunc);

const oldSend = `        // Handle file uploads (Node 20 has native FormData & Blob)
        if (payload.files && payload.files.length > 0) {
          const form = new FormData()
          form.append('payload_json', JSON.stringify(body))
          for (let i = 0; i < payload.files.length; i++) {
            const f = payload.files[i]
            const blob = new Blob([f.attachment], { type: 'application/octet-stream' })
            form.append(\`files[\${i}]\`, blob, f.name || 'file')
          }
          return await discordBotUpload(\`/channels/\${channelData.id}/messages\`, form)
        }

        return await discordBotRequest('POST', \`/channels/\${channelData.id}/messages\`, body)`;

const newSend = `        // Handle file uploads (Node 20 has native FormData & Blob)
        if (payload.files && payload.files.length > 0) {
          const form = new FormData()
          form.append('payload_json', JSON.stringify(body))
          for (let i = 0; i < payload.files.length; i++) {
            const f = payload.files[i]
            const blob = new Blob([f.attachment], { type: 'application/octet-stream' })
            form.append(\`files[\${i}]\`, blob, f.name || 'file')
          }
          const result = await discordBotUpload(\`/channels/\${channelData.id}/messages\`, form)
          return _normalizeRESTMessage(result)
        }

        const result = await discordBotRequest('POST', \`/channels/\${channelData.id}/messages\`, body)
        return _normalizeRESTMessage(result)`;

content = content.replace(oldSend, newSend);

const oldFetch = `      // Messages sub-object for fetch/delete
      messages: {
        async fetch(opts) {
          if (typeof opts === 'string') {
            // Fetch single message by ID
            return await discordBotAPI(\`/channels/\${channelData.id}/messages/\${opts}\`)
          }
          // Fetch multiple messages
          const limit = opts?.limit || 50
          const msgs = await discordBotAPI(\`/channels/\${channelData.id}/messages?limit=\${limit}\`)
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
      }`;

const newFetch = `      // Messages sub-object for fetch/delete
      messages: {
        async fetch(opts) {
          if (typeof opts === 'string') {
            // Fetch single message by ID
            const single = await discordBotAPI(\`/channels/\${channelData.id}/messages/\${opts}\`)
            return _normalizeRESTMessage(single)
          }
          // Fetch multiple messages
          const limit = opts?.limit || 50
          const msgs = await discordBotAPI(\`/channels/\${channelData.id}/messages?limit=\${limit}\`)
          // Return as a Map-like iterable, normalizing raw API snake_case to discord.js camelCase
          const map = new Map()
          for (const m of msgs) {
            _normalizeRESTMessage(m)
            m.embeds = (m.embeds || []).map(e => ({
              ...e,
              image: e.image ? { ...e.image, proxyURL: e.image.proxy_url || e.image.proxyURL } : e.image,
            }))
            map.set(m.id, m)
          }
          return map
        }
      }`;

content = content.replace(oldFetch, newFetch);

fs.writeFileSync(path, content, 'utf8');
console.log('Done');
