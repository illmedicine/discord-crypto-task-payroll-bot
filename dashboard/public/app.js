const API_BASE = localStorage.getItem("DCB_API_BASE") || "";

function getToken() {
  return localStorage.getItem("DCB_ADMIN_TOKEN") || "";
}

async function api(path, opts = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const el = (id) => document.getElementById(id);

el("saveToken").onclick = () => {
  localStorage.setItem("DCB_ADMIN_TOKEN", el("token").value.trim());
  alert("Saved token.");
  boot();
};

async function loadGuilds() {
  const guilds = await api("/api/discord/guilds");
  const s = el("guildSelect");
  s.innerHTML = "";
  guilds.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    s.appendChild(opt);
  });
  if (guilds[0]) await loadChannels(guilds[0].id);
}

async function loadChannels(guildId) {
  const chans = await api(`/api/discord/guilds/${guildId}/channels`);
  const s = el("channelSelect");
  s.innerHTML = "";
  chans.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `#${c.name}`;
    s.appendChild(opt);
  });
}

el("guildSelect").onchange = async (e) => {
  await loadChannels(e.target.value);
};

el("createEvent").onclick = async () => {
  const body = {
    guild_id: el("guildSelect").value,
    channel_id: el("channelSelect").value,
    title: el("title").value,
    description: el("desc").value,
    images: [el("img1").value, el("img2").value, el("img3").value],
    winner_index: Number(el("winner").value),
    max_seats: Number(el("seats").value),
    prize_amount: Number(el("prize").value),
    currency: el("currency").value,
    created_by: "dashboard",
  };

  await api("/api/events", { method: "POST", body: JSON.stringify(body) });
  await refreshEvents();
  alert("Event created as draft.");
};

el("refreshEvents").onclick = refreshEvents;

async function refreshEvents() {
  const list = el("events");
  list.innerHTML = "";
  const events = await api("/api/events");

  events.forEach((ev) => {
    const div = document.createElement("div");
    div.className = "item";
    const status = ev.status || "draft";
    div.innerHTML = `
      <div><b>#${ev.id}</b> — ${ev.title} <span style="opacity:.7">(${status})</span></div>
      <div class="meta">Guild: ${ev.guild_id} • Channel: ${ev.channel_id} • Seats: ${ev.max_seats} • Prize: ${ev.prize_amount} ${ev.currency}</div>
      <div class="actions">
        <button class="ghost" data-action="publish" data-id="${ev.id}">Publish to Discord</button>
      </div>
    `;
    div.querySelector("[data-action='publish']").onclick = async () => {
      await api(`/api/events/${ev.id}/publish`, { method: "POST" });
      await refreshEvents();
      alert("Published to Discord.");
    };
    list.appendChild(div);
  });
}

async function boot() {
  if (!getToken()) return;
  await loadGuilds();
  await refreshEvents();
}

boot().catch((e) => alert(e.message));
