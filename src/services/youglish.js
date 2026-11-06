// klanger — YouGlish search via their public pronounce pages, played in our own YT player.
// The official widget has a daily search quota; the search page itself embeds the
// same results in params.jsonData — same clips, no widget counter.
// ponytail: first page only (10 results), no paging until someone asks.

import { relayGet, killCaptions } from "./youtube.js";

const listeners = { fetch: [], video: [], caption: [], playbackError: [] };

function emit(kind, payload) {
  for (const fn of listeners[kind]) {
    try { fn(payload); } catch { /* listener errors must not kill playback */ }
  }
}

export function on(kind, fn) {
  listeners[kind].push(fn);
  return () => {
    const i = listeners[kind].indexOf(fn);
    if (i >= 0) listeners[kind].splice(i, 1);
  };
}

// Pure: pull the embedded results JSON out of a /pronounce/ page. Exported for tests.
export function parseYgResults(html) {
  const m = String(html).match(/params\.jsonData\s*=\s*'((?:[^'\\]|\\.)*)'/);
  if (!m) {
    if (/bot detection|captcha/i.test(html)) throw new Error("YouGlish blocked this network — try again in a minute");
    throw new Error(
      /quota|premium|exceeded/i.test(html)
        ? "Search quota hit — try again tomorrow"
        : "No results for that search"
    );
  }
  // the JSON is embedded as a JS single-quoted string — undo its escapes, then parse
  const text = m[1].replace(/\\(['"\\/bfnrt]|u[0-9a-f]{4})/gi, (mm, c) =>
    c[0] === "u" ? String.fromCharCode(parseInt(c.slice(1), 16))
    : c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r"
    : c === "b" ? "\b" : c === "f" ? "\f" : c
  );
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Couldn't read search results"); }
  if (!data.results || !data.results.length) throw new Error("No clips found for that word");
  return data;
}

let player = null;
let results = [];
let idx = 0;
let seq = 0;
let lastQuery = "";
let volume = 100;
let playerReady = false;
let lastVid = "";

function listenVisible() {
  return !document.getElementById("view-home").hidden &&
    !document.getElementById("panel-listen").hidden;
}

function loadClip(target, clip) {
  const video = { videoId: clip.vid, startSeconds: Number(clip.start) || 0 };
  if (listenVisible()) target.loadVideoById(video);
  else target.cueVideoById(video);
}

// Pure: start index for a search. Same word again → any clip except the one just shown.
// Exported for tests.
export function ygStartIndex(list, avoidVid) {
  if (!list || list.length <= 1) return 0;
  if (!avoidVid || !list.some((r) => r.vid === avoidVid)) return 0;
  const alts = [];
  for (let i = 0; i < list.length; i++) if (list[i].vid !== avoidVid) alts.push(i);
  return alts.length ? alts[(Math.random() * alts.length) | 0] : 0;
}

function whenYT() {
  return new Promise((res) => {
    if (window.YT && window.YT.Player) return res();
    const iv = setInterval(() => {
      if (window.YT && window.YT.Player) { clearInterval(iv); res(); }
    }, 150);
  });
}

async function show(i) {
  if (!results.length) return;
  idx = ((i % results.length) + results.length) % results.length;
  const r = results[idx];
  emit("video", { video: r.vid, query: lastQuery, position: idx + 1, count: results.length });
  emit("caption", { caption: r.display || "" });
  await whenYT();
  if (results[idx] !== r) return;
  const start = Number(r.start) || 0;
  if (!player) {
    // construct WITH the first clip — an empty player ignores loadVideoById
    player = new YT.Player("yg-widget", {
      videoId: r.vid,
      width: "100%",
      height: "320",
      playerVars: { origin: window.location.origin, rel: 0, playsinline: 1, modestbranding: 1, start, cc_load_policy: 0, iv_load_policy: 3 },
      events: {
        onReady: ({ target }) => {
          playerReady = true;
          target.setVolume(volume);
          killCaptions(target);
          const current = results[idx];
          if (current !== r) loadClip(target, current);
          else if (listenVisible()) target.playVideo();
        },
        onError: ({ data }) => emit("playbackError", data),
        onApiChange: () => killCaptions(player),
        onStateChange: (e) => {
          if (e.data === window.YT.PlayerState.PLAYING) {
            if (listenVisible()) killCaptions(e.target);
            else e.target.pauseVideo();
          }
          if (e.data === window.YT.PlayerState.ENDED && listenVisible()) show(idx + 1);
        },
      },
    });
  } else if (playerReady) {
    loadClip(player, r);
    killCaptions(player);
  }
}

// Called by the inline script in index.html — starts YT API polling only.
// ponytail: no default search; a boot search filled #q and flashed the clips toast on every load.
export function bootYouglish() {
  whenYT().catch(() => {});
}

export async function searchWord(q, opts) {
  q = String(q || "").trim();
  if (!q) return;
  const silent = !!(opts && opts.silent);
  const mine = ++seq;
  const html = await relayGet("https://youglish.com/pronounce/" + encodeURIComponent(q) + "/german");
  if (mine !== seq) return; // a newer search superseded this one
  const data = parseYgResults(html);
  const playable = data.results.filter((r) => r.vid && r.start != null);
  if (!playable.length) throw new Error("No playable clips for “" + q + "”");
  emit("fetch", { query: q, totalResult: data.total_results || results.length, silent });
  await whenYT();
  if (mine !== seq) return;
  // re-roll of the same word → don't land on the clip we just showed
  results = playable;
  const avoid = q === lastQuery ? lastVid : "";
  lastQuery = q;
  const start = ygStartIndex(results, avoid);
  await show(start);
  if (mine === seq) lastVid = results[idx]?.vid || "";
}

export function ygNext() { show(idx + 1); }
export function ygPrev() { show(idx - 1); }
export function ygReplay() {
  const r = results[idx];
  if (playerReady && r) player.seekTo(Number(r.start) || 0, true);
}
export function ygPause() { if (playerReady && player.pauseVideo) player.pauseVideo(); }

export function ygSetVolume(value) {
  volume = value;
  if (playerReady) player.setVolume(volume);
}
