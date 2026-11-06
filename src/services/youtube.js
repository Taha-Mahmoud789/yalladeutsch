// klanger — YouTube caption ingestion + search.
// Primary: Innertube ANDROID player API via local/worker relay.
// Fallback: watch-page scrape + legacy timedtext. Same data path YouGlish indexes.

const INNERTUBE = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const ANDROID_CTX = {
  clientName: "ANDROID",
  clientVersion: "20.10.38",
  androidSdkVersion: 30,
  hl: "de",
};

const RELAYS = [
  (u) => u,
  // jina needs x-respond-with:html (set in relayGet) or it strips params.jsonData
  (u) => "https://r.jina.ai/" + u,
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
];

const sameOriginRelay = (u) => "/api/relay?u=" + encodeURIComponent(u);

export function workerBase() {
  return (localStorage.getItem("klWorker") || "").trim().replace(/\/+$/, "");
}

// ponytail: cc_load_policy=0 cannot force captions off (viewer pref wins).
// Unload the captions module whenever the player exposes it — ready, api, playing.
export function killCaptions(pl) {
  if (!pl) return;
  try { if (pl.unloadModule) pl.unloadModule("captions"); } catch { /* module not up yet */ }
  try { if (pl.setOption) pl.setOption("captions", "track", {}); } catch { /* ditto */ }
}

const TIMEOUT_MS = 8000;
const withTimeout = (u, opts) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  return fetch(u, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
};

// Bot-challenge / reader stubs are HTTP 200 but useless — never return them
// or the first relay wins and later working mirrors never run.
// ponytail: only reject actual challenge pages — "captcha" appears as a word
// inside healthy YouGlish HTML and must not fail the check.
const usable = (text) =>
  !!text && text.length > 1 &&
  !text.startsWith("Title:") &&
  !/bot detection/i.test(text);

export async function relayGet(url) {
  let throttled = false;
  {
    try {
      const res = await withTimeout(sameOriginRelay(url));
      if (res.ok) {
        const text = await res.text();
        if (usable(text)) return text;
      }
      if (res.status === 429) throttled = true;
    } catch { /* fall through */ }
  }
  const wb = workerBase();
  if (wb) {
    try {
      const res = await withTimeout(wb + "/?u=" + encodeURIComponent(url));
      if (res.ok) {
        const text = await res.text();
        if (usable(text)) return text;
      }
    } catch { /* fall through */ }
  }
  let lastErr = "all caption relays failed";
  for (const mk of RELAYS) {
    try {
      const mkUrl = mk(url);
      const isJina = mkUrl.includes("r.jina.ai");
      const res = await withTimeout(mkUrl, {
        redirect: "follow",
        ...(isJina ? { headers: { "x-respond-with": "html" } } : {}),
      });
      if (!res.ok) {
        if (res.status === 429) throttled = true;
        lastErr = (throttled)
          ? "HTTP 429 — YouTube rate-limited this network temporarily"
          : "HTTP " + res.status + " via " + new URL(mkUrl, location).host;
        if (throttled) break;
        continue;
      }
      const text = await res.text();
      if (!usable(text)) { lastErr = "empty/garbled response"; continue; }
      return text;
    } catch (e) { lastErr = e.message || String(e); }
  }
  throw new Error(lastErr);
}

export async function relayPost(url, body) {
  const wb = workerBase();
  {
    try {
      const res = await withTimeout(sameOriginRelay(url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.ok) return res.text();
      if (res.status !== 502 && res.status !== 404)
        throw new Error("same-origin relay HTTP " + res.status);
    } catch (e) {
      if (!wb) throw e;
    }
  }
  if (!wb) throw new Error("no caption relay configured");
  const res = await fetch(wb + "/?u=" + encodeURIComponent(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error("relay HTTP " + res.status);
  return res.text();
}

export function parseVideoId(input) {
  const s = (input || "").trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//.test(s) ? s : "https://" + s);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    const q = u.searchParams.get("v");
    if (q && /^[a-zA-Z0-9_-]{11}$/.test(q)) return q;
    const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  } catch { /* not a URL */ }
  return null;
}

export async function fetchCaptionTracks(videoId) {
  try {
    const j = JSON.parse(await relayPost(
      INNERTUBE,
      JSON.stringify({ videoId, context: { client: ANDROID_CTX } })
    ));
    const tracks = j?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (tracks.length) return sortTracks(tracks);
  } catch { /* fall through */ }
  const html = await relayGet(
    "https://www.youtube.com/watch?v=" + videoId + "&hl=de&bpctr=9999999999"
  );
  const m = html.match(/"captionTracks":(\[[\s\S]*?\])/);
  if (!m) throw new Error("no captionTracks on the watch page");
  const tracks = JSON.parse(m[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/"));
  return sortTracks(tracks);
}

function sortTracks(tracks) {
  return tracks
    .filter((t) => (t.languageCode || "").toLowerCase().startsWith("de"))
    .sort((a, b) => (a.kind === "asr") - (b.kind === "asr"));
}

// Confirmed-live German channels for library fallback (probed against /@handle/videos).
export const SEEDS = [
  { h: "EasyGerman", n: "Easy German" },
  { h: "tagesschau", n: "Tagesschau" },
  { h: "MrWissen2go", n: "MrWissen2go" },
  { h: "ZDFheute", n: "ZDFheute" },
  { h: "dwdeutsch", n: "DW Deutsch" },
  { h: "EasyDeutsch", n: "EasyDeutsch" },
];

export async function fetchMeta(videoId) {
  try {
    const j = JSON.parse(
      await relayGet("https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=" + videoId + "&format=json")
    );
    return { title: j.title || "", author_name: j.author_name || "" };
  } catch { return null; }
}

// Recent video IDs from a channel page (scrape — no API key).
export async function channelVideoIds(handle, limit = 12) {
  const html = await relayGet(
    "https://www.youtube.com/@" + handle + "/videos?hl=de&bpctr=9999999999"
  );
  const ids = [];
  for (const m of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
    if (ids.length >= limit) break;
  }
  return ids;
}

// Global word search fallback: YouTube results page with CC filter, then caption probe.
// sp=EgIwAQ%3D%3D = type video + subtitles/CC. Returns [{id,title,channel}].
export async function youtubeSearchIds(query, limit = 12) {
  const html = await relayGet(
    "https://www.youtube.com/results?search_query=" +
    encodeURIComponent(query + " deutsch") +
    "&sp=EgIwAQ%3D%3D&hl=de"
  );
  const out = [];
  const seen = new Set();
  // pair videoId with nearby title when possible
  for (const m of html.matchAll(/"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]*?"title":\{"runs":\[\{"text":"([^"]+)"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], title: decodeJsonString(m[2]) });
    if (out.length >= limit) break;
  }
  if (!out.length) {
    for (const m of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: m[1], title: "" });
      if (out.length >= limit) break;
    }
  }
  return out;
}

function decodeJsonString(s) {
  try { return JSON.parse('"' + s + '"'); } catch { return s; }
}

// Returns {cues, src} or null.
export async function fetchCues(videoId) {
  let tracks = [];
  try { tracks = await fetchCaptionTracks(videoId); } catch { /* try legacy */ }
  let lastErr = "";
  for (const t of tracks) {
    try {
      const u = new URL(t.baseUrl);
      u.searchParams.delete("fmt");
      u.searchParams.set("fmt", "json3");
      const j = JSON.parse(await relayGet(u.toString()));
      const cues = json3ToCues(j);
      if (cues.length) return { cues, src: t.kind === "asr" ? "auto" : "manual" };
    } catch (e) {
      if (/429/i.test(String(e.message))) { lastErr = e.message; break; }
    }
  }
  if (!tracks.length || lastErr) {
    for (const q of ["lang=de", "lang=de-DE", "lang=de&kind=asr", "lang=de-DE&kind=asr"]) {
      try {
        const txt = await relayGet(
          "https://www.youtube.com/api/timedtext?v=" + videoId + "&" + q + "&fmt=json3"
        );
        if (!txt || !txt.includes("tStartMs")) continue;
        const cues = json3ToCues(JSON.parse(txt));
        if (cues.length) return { cues, src: q.includes("asr") ? "auto" : "manual" };
      } catch (e) {
        if (/429/i.test(String(e.message))) { lastErr = e.message; break; }
      }
    }
  }
  if (lastErr) throw new Error(lastErr);
  return null;
}

export function json3ToCues(j) {
  const cues = [];
  for (const ev of (j && j.events) || []) {
    if (!ev.segs || ev.aAppend) continue;
    const words = [];
    for (const seg of ev.segs) {
      const wstart = (ev.tStartMs + (seg.tOffsetMs || 0)) / 1000;
      for (const p of (seg.utf8 || "").trim().split(/\s+/)) {
        if (p) words.push({ start: wstart, text: p });
      }
    }
    if (!words.length) continue;
    cues.push({
      start: ev.tStartMs / 1000,
      dur: Math.max(0.4, (ev.dDurationMs || 2000) / 1000),
      text: words.map((w) => w.text).join(" "),
      words,
    });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

export function subToCues(text) {
  const cues = [];
  const ts =
    /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;
  for (const block of String(text || "").replace(/\r/g, "").split(/\n\s*\n/)) {
    const m = block.match(ts);
    if (!m) continue;
    const ms = (x) => +String(x).padEnd(3, "0") / 1000;
    const start = +m[1] * 3600 + +m[2] * 60 + +m[3] + ms(m[4]);
    const end = +m[5] * 3600 + +m[6] * 60 + +m[7] + ms(m[8]);
    const body = block
      .slice(m.index + m[0].length)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^\d+$/.test(l))
      .join(" ");
    if (!body) continue;
    cues.push({
      start,
      dur: Math.max(0.4, end - start),
      text: body,
      words: body.split(/\s+/).map((w) => ({ start, text: w })),
    });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

// Find cue index whose text best matches a caption line (YouGlish handoff).
export function findCueByText(cues, caption) {
  const n = caption.replace(/\[\[\[|\]\]\]/g, "").trim().toLowerCase();
  if (!n) return -1;
  let best = -1, bestR = 0;
  for (let i = 0; i < cues.length; i++) {
    const t = cues[i].text.toLowerCase();
    if (t === n) return i;
    if (!(t.includes(n) || n.includes(t))) continue;
    const min = Math.min(t.length, n.length);
    // ponytail: accept any real containment (≥4 chars) ranked tightest-first;
    // YouGlish captions are full lines, the old 0.5 ratio gate rejected them.
    if (min < 4) continue;
    const r = min / Math.max(t.length, n.length);
    if (r > bestR) { bestR = r; best = i; }
  }
  return best;
}
