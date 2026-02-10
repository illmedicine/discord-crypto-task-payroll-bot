require("dotenv").config();
const express = require("express");
const cors = require("cors");

const db = require("../utils/db");

const app = express();
app.use(express.json({ limit: "10mb" }));

app.use(
  cors({
    origin: process.env.DASHBOARD_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || token !== process.env.DASHBOARD_ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

async function discordFetch(path, opts = {}) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("Missing DISCORD_TOKEN");

  const res = await fetch(`https://discord.com/api/v10${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${token}`,
      ...(opts.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord API ${res.status}: ${text}`);
  }
  return res.json();
}

const cache = new Map();
function cacheGet(key, ttlMs) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > ttlMs) return null;
  return hit.v;
}
function cacheSet(key, v) {
  cache.set(key, { v, t: Date.now() });
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/discord/guilds", requireAdmin, async (_req, res) => {
  try {
    const cached = cacheGet("guilds", 60_000);
    if (cached) return res.json(cached);

    const guilds = await discordFetch("/users/@me/guilds");
    const out = guilds.map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
    }));

    cacheSet("guilds", out);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/discord/guilds/:guildId/channels", requireAdmin, async (req, res) => {
  try {
    const { guildId } = req.params;
    const cacheKey = `channels:${guildId}`;
    const cached = cacheGet(cacheKey, 60_000);
    if (cached) return res.json(cached);

    const channels = await discordFetch(`/guilds/${guildId}/channels`);
    const out = channels
      .filter((c) => [0, 5].includes(c.type))
      .map((c) => ({ id: c.id, name: c.name, type: c.type }));

    cacheSet(cacheKey, out);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function ensureEventTables() {
  return new Promise((resolve, reject) => {
    db.db.serialize(() => {
      db.db.run(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          images_json TEXT NOT NULL,
          winner_index INTEGER NOT NULL,
          max_seats INTEGER NOT NULL,
          prize_amount REAL NOT NULL,
          currency TEXT DEFAULT 'USD',
          status TEXT DEFAULT 'draft',
          created_by TEXT NOT NULL,
          message_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          starts_at DATETIME,
          ends_at DATETIME
        )
      `);

      db.db.run(
        `
        CREATE TABLE IF NOT EXISTS event_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL,
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          vote_index INTEGER,
          entered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          voted_at DATETIME,
          is_winner INTEGER DEFAULT 0,
          paid_signature TEXT,
          UNIQUE(event_id, user_id),
          FOREIGN KEY(event_id) REFERENCES events(id)
        )
      `,
        (err) => (err ? reject(err) : resolve())
      );
    });
  });
}

app.post("/api/events", requireAdmin, async (req, res) => {
  try {
    await ensureEventTables();

    const {
      guild_id,
      channel_id,
      title,
      description,
      images,
      winner_index,
      max_seats,
      prize_amount,
      currency,
      created_by,
    } = req.body;

    if (!guild_id || !channel_id || !title || !Array.isArray(images) || images.length < 3) {
      return res
        .status(400)
        .json({ error: "Missing required fields (guild, channel, title, 3 images)" });
    }

    const images_json = JSON.stringify(images);
    const w = Number(winner_index);
    if (![0, 1, 2].includes(w)) return res.status(400).json({ error: "winner_index must be 0,1,2" });

    const seats = Number(max_seats);
    if (!Number.isFinite(seats) || seats < 2) return res.status(400).json({ error: "max_seats must be >= 2" });

    const prize = Number(prize_amount);
    if (!Number.isFinite(prize) || prize <= 0) return res.status(400).json({ error: "prize_amount must be > 0" });

    await new Promise((resolve, reject) => {
      db.db.run(
        `INSERT INTO events (guild_id, channel_id, title, description, images_json, winner_index, max_seats, prize_amount, currency, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          guild_id,
          channel_id,
          title,
          description || "",
          images_json,
          w,
          seats,
          prize,
          currency || "USD",
          created_by || "dashboard",
        ],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/events", requireAdmin, async (_req, res) => {
  try {
    await ensureEventTables();
    db.db.all(`SELECT * FROM events ORDER BY created_at DESC LIMIT 100`, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/events/:id/publish", requireAdmin, async (req, res) => {
  try {
    await ensureEventTables();

    const eventId = Number(req.params.id);
    const ev = await new Promise((resolve, reject) => {
      db.db.get(`SELECT * FROM events WHERE id = ?`, [eventId], (err, row) => (err ? reject(err) : resolve(row)));
    });
    if (!ev) return res.status(404).json({ error: "Event not found" });

    const images = JSON.parse(ev.images_json);

    const embed = {
      title: `🎉 DCB Event: ${ev.title}`,
      description:
        `${ev.description || ""}\n\n` +
        `**Seats:** ${ev.max_seats}\n` +
        `**Prize Pool:** ${ev.prize_amount} ${ev.currency}\n\n` +
        `Click **Join Event** to claim a seat. Voting starts when full.`,
      color: 0x22d3ee,
      image: { url: images[0] },
      footer: { text: `DisCryptoBank Events • Event #${ev.id}` },
    };

    const components = [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Join Event",
            custom_id: `event_join_${ev.id}`,
          },
        ],
      },
    ];

    const msg = await discordFetch(`/channels/${ev.channel_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ embeds: [embed], components }),
    });

    await new Promise((resolve, reject) => {
      db.db.run(
        `UPDATE events SET status='active', message_id=?, starts_at=CURRENT_TIMESTAMP WHERE id=?`,
        [msg.id, ev.id],
        (err) => (err ? reject(err) : resolve())
      );
    });

    res.json({ ok: true, message_id: msg.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use("/", express.static(require("path").join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Dashboard] ✅ running on :${PORT}`));
