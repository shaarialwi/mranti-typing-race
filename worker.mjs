// MRANTI-Typing-Race-GitHub/src/lib/race.ts
var MAP_PINS = [{ x: 110, y: 258 }, { x: 158, y: 284 }, { x: 215, y: 260 }, { x: 268, y: 270 }, { x: 306, y: 305 }, { x: 252, y: 327 }, { x: 204, y: 351 }, { x: 146, y: 350 }, { x: 110, y: 320 }, { x: 210, y: 411 }, { x: 260, y: 392 }, { x: 310, y: 363 }, { x: 350, y: 289 }, { x: 399, y: 274 }, { x: 449, y: 265 }, { x: 492, y: 281 }, { x: 491, y: 322 }, { x: 440, y: 319 }, { x: 394, y: 318 }, { x: 585, y: 84 }, { x: 641, y: 62 }, { x: 691, y: 70 }, { x: 687, y: 111 }, { x: 618, y: 112 }, { x: 620, y: 163 }, { x: 670, y: 185 }, { x: 698, y: 235 }, { x: 335, y: 337 }];
var defaultPoints = (n) => Array.from({ length: Math.max(0, n) }, (_, i) => ({ ...MAP_PINS[i % MAP_PINS.length], ...i >= MAP_PINS.length ? { x: Math.min(765, MAP_PINS[i % MAP_PINS.length].x + 17), y: Math.min(465, MAP_PINS[i % MAP_PINS.length].y + 17) } : {} }));
function resolvePoints(points, n) {
  const oldRing = points.length === n && points.every((p, i) => p.x === Math.round(395 + 270 * Math.cos(Math.PI / 2 + (i + 1) / n * Math.PI * 2)) && p.y === Math.round(245 + 165 * Math.sin(Math.PI / 2 + (i + 1) / n * Math.PI * 2)));
  return oldRing ? defaultPoints(n) : points;
}
function parsePoints(value, n) {
  if (!Array.isArray(value) || value.length !== n) throw Error("Set a map position for every checkpoint.");
  if (value.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 25 || p.x > 765 || p.y < 25 || p.y > 465)) throw Error("Checkpoint position is outside the map.");
  return value.map((p) => ({ x: p.x, y: p.y }));
}
var normalise = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
function parseWords(input) {
  if (typeof input !== "string") throw Error("Enter one phrase per line.");
  const words = input.split("\n").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (words.length < 2 || words.length > 50) throw Error("Use between 2 and 50 checkpoints.");
  if (words.some((w) => w.length > 60)) throw Error("Each phrase must be 60 characters or fewer.");
  return words;
}
function rank(a, b) {
  if (a.finished && b.finished) return a.finished - b.finished;
  if (a.finished) return -1;
  if (b.finished) return 1;
  return b.chars - a.chars || a.errors - b.errors;
}
function snapshot(s, token, now = Date.now()) {
  const me = s.players.find((p) => p.token === token);
  if (!me && token !== s.host) throw Error("This player session is invalid. Return to the entrance.");
  const ended = !!s.start && (now >= s.start + s.duration * 1e3 || s.players.every((p) => p.finished));
  return { code: s.code, points: resolvePoints(s.points, s.phrases.length), phrases: s.phrases, start: s.start, duration: s.duration, ended, serverNow: now, host: s.host === token, moderator: s.host === token && !me, moderatorName: s.moderatorName || "Moderator", me: me?.id || "moderator", players: s.players.map(({ token: token2, ...p }) => p).sort((a, b) => rank(a, b)) };
}
function apply(s, token, b, now = Date.now()) {
  const p = s.players.find((p2) => p2.token === token);
  if (!p && token !== s.host) throw Error("Invalid player session.");
  if (b.action === "ready") {
    if (!p) throw Error("Moderator does not need to mark ready.");
    if (s.start) throw Error("The race has started.");
    p.ready = !p.ready;
  } else if (b.action === "settings") {
    if (s.host !== token || s.start) throw Error("Only the host can edit the waiting room.");
    s.phrases = parseWords(b.words);
    s.points = parsePoints(b.points, s.phrases.length);
    if (![60, 120, 180, 300, 600].includes(b.duration)) throw Error("Choose a valid duration.");
    s.duration = b.duration;
    s.players.forEach((p2) => p2.ready = p2.token === s.host);
  } else if (b.action === "start") {
    if (s.host !== token) throw Error("Only the host can start.");
    if (s.start) throw Error("Race already started.");
    if (!s.players.length) throw Error("Wait for at least one player to join.");
    if (!s.players.every((p2) => p2.ready)) throw Error("Wait until everyone is ready.");
    s.start = now + 5e3;
  } else if (b.action === "type") {
    if (!p) throw Error("Moderator does not type.");
    if (!s.start || now < s.start || snapshot(s, token, now).ended) throw Error("The race is not active.");
    if (p.finished) throw Error("You already finished.");
    if (b.index !== p.index) throw Error("Progress changed. Check the current phrase.");
    if (typeof b.text !== "string" || b.text.length > 100) throw Error("Invalid typed phrase.");
    if (normalise(b.text) !== normalise(s.phrases[p.index])) throw Error("Correct the phrase before continuing.");
    const expected = s.phrases[p.index].length;
    const errors = Number.isSafeInteger(b.errors) && b.errors >= 0 && b.errors < 1e4 ? b.errors : 0;
    const attempts = Number.isSafeInteger(b.attempts) && b.attempts >= expected && b.attempts < 1e4 ? b.attempts : expected + errors;
    p.errors += errors;
    p.attempts += Math.max(attempts, expected + errors);
    p.chars += expected;
    p.index++;
    p.splits.push(now);
    if (p.index === s.phrases.length) p.finished = now;
  } else throw Error("Unknown action.");
  return s;
}

// MRANTI-Typing-Race-GitHub/backend/worker.ts
var json = (d, status = 200) => Response.json(d, { status, headers: { "Cache-Control": "no-store" } });
var player = (name, token, ready = false) => ({ id: crypto.randomUUID(), token, name, index: 0, chars: 0, errors: 0, attempts: 0, finished: 0, ready, splits: [] });
async function POST(req, env) {
  try {
    const b = await req.json();
    const db = env.DB;
    if (!db) return json({ error: "Race storage is unavailable. Try again later." }, 503);
    if (b.action === "create") {
      const name = String(b.name || "").trim().slice(0, 24);
      if (!name) throw Error("Enter your name.");
      const phrases = parseWords(b.words);
      if (![60, 120, 180, 300, 600].includes(b.duration)) throw Error("Choose a valid duration.");
      const token = crypto.randomUUID(), code2 = crypto.randomUUID().slice(0, 6).toUpperCase();
      const s = { points: parsePoints(b.points, phrases.length), code: code2, host: token, moderatorName: name, phrases, start: 0, duration: b.duration, players: [] };
      await db.prepare("INSERT INTO races(code,data,revision) VALUES(?,?,0)").bind(code2, JSON.stringify(s)).run();
      return json({ ...snapshot(s, token), token });
    }
    const code = String(b.code || "").toUpperCase();
    for (let i = 0; i < 6; i++) {
      const row = await db.prepare("SELECT data,revision FROM races WHERE code=?").bind(code).first();
      if (!row) throw Error("Room not found. Check the six-character room code.");
      const s = JSON.parse(row.data);
      let token = b.token;
      if (b.action === "state") return json(snapshot(s, token));
      if (b.action === "join") {
        if (s.start) throw Error("This race has started. Ask the host for a new room.");
        if (s.players.length >= 20) throw Error("This room already has 20 players.");
        const name = String(b.name || "").trim().slice(0, 24);
        if (!name) throw Error("Enter your name.");
        if (s.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw Error("That name is taken in this room.");
        token = crypto.randomUUID();
        s.players.push(player(name, token));
      } else apply(s, token, b);
      const result = await db.prepare("UPDATE races SET data=?,revision=revision+1 WHERE code=? AND revision=?").bind(JSON.stringify(s), code, row.revision).run();
      if (result.meta.changes) return json({ ...snapshot(s, token), token });
    }
    return json({ error: "The room is busy. Please try again." }, 409);
  } catch (e) {
    return json({ error: e.message || "Unable to reach the race." }, 400);
  }
}
var worker_default = { async fetch(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return new Response("Origin not allowed", { status: 403 });
  const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST" || new URL(req.url).pathname !== "/api/race") return new Response("Not found", { status: 404, headers });
  if (Number(req.headers.get("Content-Length") || 0) > 2e4) return new Response("Too large", { status: 413, headers });
  const response = await POST(req, env);
  const h = new Headers(response.headers);
  Object.entries(headers).forEach(([k, v]) => h.set(k, v));
  return new Response(response.body, { status: response.status, headers: h });
} };
export {
  worker_default as default
};
