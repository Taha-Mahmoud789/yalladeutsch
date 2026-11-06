import { normalize, matchCues, pickVideoRow } from "../core/dictation.js";
import { B1_WORDS } from "../core/words.js";
import { parseVideoId, fetchCues, subToCues, workerBase, fetchMeta, channelVideoIds, SEEDS, findCueByText, youtubeSearchIds } from "../services/youtube.js";
import * as VT from "../services/vocatype.js";
import * as YG from "../services/youglish.js";
import { dbGet, dbAll, dbPut } from "../data/db.js";
import { exportAll, importAll } from "../data/store.js";
import { $, esc, fmt, toast } from "./dom.js";
import { openTrainer } from "./trainer.js";
import { renderDue, statsLine } from "./progress.js";

const state = { pendingId: null, hero: null, autoDeal: false, ygVideo: null, ygCaption: "" };

/* ---------- relay setting ---------- */
$("relay-url").value = workerBase();
$("relay-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("relay-url").value.trim().replace(/\/+$/, "");
  localStorage.setItem("klWorker", v);
  toast(v ? "Relay saved" : "Relay cleared", 1500);
});

/* ---------- home tabs ---------- */
let captionRequest = 0;
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => {
      x.classList.toggle("on", x === t);
      x.setAttribute("aria-pressed", String(x === t));
    });
    for (const id of ["listen", "library", "corpus"]) {
      $("panel-" + id).hidden = t.dataset.tab !== id;
    }
    if (t.dataset.tab !== "listen") {
      captionRequest++;
      setCaptionStatus("");
      YG.ygPause();
    }
    if (t.dataset.tab === "library") loadLibrary().catch(() => {});
    if (t.dataset.tab === "corpus") { updateCorpusCount(); statsLine(); }
  });
});

/* ---------- home roulette ---------- */
// refresh rolls a fresh word on home; "Another word" rolls + opens a new practice clip
$("reroll").addEventListener("click", () => { state.autoDeal = true; rollWord().catch(showRollError); });
$("hero-go").addEventListener("click", () => {
  const h = state.hero;
  if (!h) return;
  const r = h.row;
  openTrainer(r.p.id, r.p.cues, r.p.src, { ci: r.ci, time: r.time, needle: h.word, dictate: true });
});
rollWord().catch(showRollError);

function showRollError(error) {
  state.autoDeal = false;
  state.hero = null;
  $("hero-go").disabled = true;
  $("hero-info").textContent = "Could not pick a word. Press ↻ to try again.";
  console.error("Random word selection failed", error);
}

async function rollWord() {
  const packs = (await dbAll().catch(() => [])).filter((pack) =>
    Array.isArray(pack?.cues) && pack.cues.length && pack.cues.every((cue) =>
      Array.isArray(cue?.words) && cue.words.every((word) => typeof word?.text === "string")));
  const go = $("hero-go");
  go.disabled = true;
  // rolled word → search field + auto YouGlish clip; silent = background load, don't toast
  const hear = (w, silent) => {
    $("q").value = w;
    document.querySelector('[data-tab="listen"]').click();
    YG.searchWord(w, { silent: !!silent }).catch((err) => {
      if (!silent) toast((err && err.message) || "Search failed — one moment…", 4000);
    });
  };
  function useDefaultWord() {
    // still let them hear a random word via YouGlish
    const w = B1_WORDS[(Math.random() * B1_WORDS.length) | 0];
    state.hero = null;
    $("hero-thumb").hidden = true;
    $("hero-thumb").style.background = "";
    $("hero-word").textContent = w;
    $("hero-info").textContent = "Tap to hear natives say it →";
    go.disabled = false;
    go.textContent = "Hear this word →";
    // non-silent only on explicit button press; autoDeal must not re-hear loudly
    go.onclick = () => hear(w, false);
    hear(w, true);
    state.autoDeal = false;
    return;
  }
  if (!packs.length) return useDefaultWord();
  go.onclick = null;
  go.textContent = "Practice this word in a real clip";

  // one pass: every B1 word that actually hits the corpus
  const hits = [];
  for (const word of B1_WORDS) {
    const n = normalize(word);
    const rows = [];
    for (const p of packs) {
      for (const h of matchCues(p.cues, n)) {
        const w = h.wi.length ? p.cues[h.ci].words[h.wi[0]] : null;
        rows.push({ p, ci: h.ci, time: w ? w.start : p.cues[h.ci].start, wi: h.wi });
      }
    }
    if (rows.length) hits.push({ word, n, rows });
  }
  // thin B1 pool → top up with other corpus words so refreshes aren't 5 banners on repeat
  let pool = hits;
  if (hits.length < 8) {
    const seen = new Set(hits.map((h) => h.n));
    const extras = [];
    for (const p of packs) {
      for (let ci = 0; ci < p.cues.length && extras.length < 40; ci++) {
        const c = p.cues[ci];
        for (let wi = 0; wi < c.words.length && extras.length < 40; wi++) {
          const n = normalize(c.words[wi].text);
          if (!n || n.length < 4 || n.length > 18 || seen.has(n) || /\d/.test(n)) continue;
          seen.add(n);
          extras.push({
            word: c.words[wi].text, n,
            rows: [{ p, ci, time: c.words[wi].start, wi: [wi] }],
          });
        }
      }
    }
    pool = hits.concat(extras);
  }
  if (pool.length) {
    const pick = pool[(Math.random() * pool.length) | 0];
    // same word rolled twice in a row → different practice video when one exists
    const prevVid = state.hero && state.hero.row ? state.hero.row.p.id : "";
    const row = pickVideoRow(pick.rows, prevVid);
    state.hero = { word: pick.n, rows: pick.rows, row };
    // provisional thumb from the practice pick; YouGlish "video" event replaces
    // it with the clip actually shown below (any result index)
    $("hero-thumb").style.background =
      "var(--hero-overlay), " +
      "url(\"https://i.ytimg.com/vi/" + row.p.id + "/hqdefault.jpg\") center/cover no-repeat";
    $("hero-thumb").hidden = false;
    $("hero-word").textContent = pick.word;
    $("hero-info").textContent =
      pick.rows.length + " sentence" + (pick.rows.length > 1 ? "s" : "") + " in your corpus — one is drawn at random";
    go.disabled = false;
    hear(pick.word, true);
    if (state.autoDeal) { state.autoDeal = false; go.click(); }
    return;
  }
  useDefaultWord();
}

/* ---------- corpus / search ---------- */
$("q-form").addEventListener("submit", (e) => {
  e.preventDefault();
  searchCorpus($("cq").value.trim()).catch((err) => toast("Search failed: " + (err.message || err)));
});
$("seed").addEventListener("click", () => seedChannels().catch((e) => toast("Seeding failed: " + (e.message || e))));
$("review").addEventListener("click", () => renderDue(openTrainer).catch((e) => toast(e.message || e)));
$("export").addEventListener("click", () =>
  exportAll().then((d) =>
    download("yalladeutsch-backup-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(d))
  )
);
$("import-file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    await importAll(JSON.parse(await f.text()));
    toast("Backup imported — reloading");
    setTimeout(() => location.reload(), 900);
  } catch (err) { toast("Import failed: " + (err.message || err)); }
  e.target.value = "";
});

function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function rankRows(rows) {
  return rows
    .map((r) => {
      const c = r.p.cues[r.ci];
      let s = 0;
      if (r.p.src !== "auto") s += 3;
      const len = c.text.length;
      if (len >= 25 && len <= 110) s += 2;
      s += Math.min((r.wi ? r.wi.length : 1) - 1, 3);
      return { r, s };
    })
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r);
}

async function searchCorpus(q) {
  const packs = await dbAll().catch(() => []);
  if (!packs.length) {
    renderResults([], q, "Corpus empty — open a video in Library first, then search again.");
    return;
  }
  const rows = [];
  for (const p of packs) {
    for (const h of matchCues(p.cues, q)) {
      const w = h.wi.length ? p.cues[h.ci].words[h.wi[0]] : null;
      rows.push({ p, ci: h.ci, time: w ? w.start : p.cues[h.ci].start, wi: h.wi });
      if (rows.length >= 250) break;
    }
    if (rows.length >= 250) break;
  }
  renderResults(rankRows(rows).slice(0, 40), q);
}

function renderResults(rows, q, emptyMsg) {
  const box = $("q-results");
  box.innerHTML = "";
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = emptyMsg || ("No sentences with “" + q + "” yet — add channels below, or paste the video where you met this word.");
    box.appendChild(p);
    return;
  }
  const n = normalize(q);
  for (const r of rows) {
    const c = r.p.cues[r.ci];
    const b = document.createElement("button");
    b.className = "q-result";
    b.innerHTML = "<b>" + esc(r.p.channel || r.p.title) + "</b><i>" + fmt(c.start) + "</i><span>" + markTokens(c, n) + "</span>";
    b.addEventListener("click", () => {
      openTrainer(r.p.id, r.p.cues, r.p.src, { ci: r.ci, time: r.time, needle: n });
    });
    box.appendChild(b);
  }
}

function markTokens(c, n) {
  return c.words.map((w) => {
    const wn = normalize(w.text);
    return wn === n || (n.length >= 4 && wn.includes(n))
      ? "<mark>" + esc(w.text) + "</mark>"
      : esc(w.text);
  }).join(" ");
}

async function seedChannels() {
  const btn = $("seed");
  btn.disabled = true;
  try {
    const have = new Set((await dbAll()).map((p) => p.id));
    let added = 0;
    for (const s of SEEDS) {
      $("corpus-line").textContent = "Indexing " + s.n + "…";
      let ids = [];
      try { ids = await channelVideoIds(s.h, 5); } catch { continue; }
      for (const id of ids) {
        if (have.has(id)) continue;
        have.add(id);
        try {
          const d = await fetchCues(id);
          if (d) { await indexPack(id, d.cues, d.src, s.n); added++; }
        } catch { /* one failure is not news */ }
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    updateCorpusCount();
    toast(added ? "Indexed " + added + " new videos" : "0 indexed — set the caption relay and retry", 3200);
  } finally {
    btn.disabled = false;
  }
}

async function indexPack(id, cues, src, channel) {
  try {
    const meta = channel ? { title: channel, author_name: channel } : await fetchMeta(id);
    await dbPut({
      id,
      title: (meta && meta.title) || "Untitled",
      channel: (meta && meta.author_name) || channel || "",
      src,
      addedAt: Date.now(),
      cues,
    });
    updateCorpusCount();
  } catch { /* indexing must never break playback */ }
}

async function updateCorpusCount() {
  const ps = await dbAll().catch(() => []);
  $("corpus-line").textContent = ps.length
    ? "Your corpus: " + ps.length + " videos · " + ps.reduce((a, p) => a + p.cues.length, 0) + " sentences"
    : "Corpus empty — open a video from Library to start indexing it";
}

$("use-pasted").addEventListener("click", () => {
  const cues = subToCues($("sub-text").value);
  if (!cues.length) return toast("No timestamped lines found in that paste");
  openTrainer(state.pendingId, cues, "pasted");
});

/* ---------- URL load ---------- */
$("url-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await loadFromUrl();
});

async function loadFromUrl() {
  const id = parseVideoId($("url-input").value);
  if (!id) return toast("Paste a YouTube URL or an 11-char video ID");
  state.pendingId = id;
  try {
    const cached = await dbGet(id);
    if (cached && cached.cues.length) {
      openTrainer(id, cached.cues, cached.src);
      return;
    }
  } catch { /* fresh path */ }
  toast("Fetching German captions…");
  try {
    const data = await fetchCues(id);
    if (data && data.cues.length) {
      openTrainer(id, data.cues, data.src);
      indexPack(id, data.cues, data.src, "");
    } else noCaptions("No German captions found for that video.");
  } catch (err) {
    noCaptions(
      "Caption fetch failed (" + (err.message || err) + ")." +
      (/429/.test(String(err.message || ""))
        ? " YouTube rate-limited this network — wait ~1 hour, or deploy the caption relay."
        : "")
    );
  }
}

function noCaptions(msg) {
  $("home-msg").textContent =
    msg + " You can: set the caption relay, try another video, or paste .vtt/.srt captions:";
  $("paste-fallback").hidden = false;
  document.getElementById("relay-box").open = !workerBase();
}

/* ---------- library (VocaType) ---------- */
let libLoaded = false;
async function loadLibrary(force) {
  if (libLoaded && !force) return;
  const grid = $("lib-grid");
  const st = $("lib-status");
  grid.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  st.textContent = "loading catalog…";
  try {
    const rows = await VT.listGermanVideos(36);
    libLoaded = true;
    if (!rows.length) {
      grid.innerHTML = "";
      st.textContent = "0 German videos in catalog — using seed channels instead";
      await seedIntoGrid();
      return;
    }
    st.textContent = rows.length + " German clips with captions";
    grid.innerHTML = "";
    rows.map(VT.toCard).forEach((c, i) => grid.appendChild(vcard(c, i)));
  } catch (e) {
    st.textContent = "catalog unavailable (" + (e.message || e) + ") — seed channels instead";
    await seedIntoGrid();
  }
}

$("lib-reload").addEventListener("click", () => loadLibrary(true).catch(() => {}));

async function seedIntoGrid() {
  const grid = $("lib-grid");
  grid.innerHTML = "";
  for (const s of SEEDS.slice(0, 4)) {
    try {
      const ids = await channelVideoIds(s.h, 3);
      for (const id of ids) {
        grid.appendChild(vcard({
          id, title: s.n, channel: s.n,
          thumb: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg",
          duration: 0, hasCaptions: true,
        }, 0));
      }
    } catch { /* next seed */ }
  }
}

function vcard(c, i) {
  const b = document.createElement("button");
  b.className = "vcard";
  b.type = "button";
  b.style.animationDelay = Math.min(i * 40, 400) + "ms";
  b.innerHTML =
    '<div class="thumb">' +
    (c.duration ? '<span class="dur">' + fmt(c.duration) + "</span>" : "") +
    "</div>" +
    '<div class="body"><div class="t">' + esc(c.title) + "</div>" +
    '<div class="c">' + esc(c.channel || "YouTube") + "</div></div>";
  try {
    const thumbnail = new URL(c.thumb);
    if (thumbnail.protocol === "https:") {
      b.querySelector(".thumb").style.backgroundImage = "url(" + JSON.stringify(thumbnail.href) + ")";
    }
  } catch { /* keep the placeholder */ }
  b.addEventListener("click", () => openById(c.id));
  return b;
}

async function openById(id) {
  try {
    const cached = await dbGet(id);
    if (cached && cached.cues.length) {
      openTrainer(id, cached.cues, cached.src);
      return;
    }
  } catch { /* fetch */ }
  toast("Fetching German captions…");
  try {
    const data = await fetchCues(id);
    if (data && data.cues.length) {
      openTrainer(id, data.cues, data.src);
      indexPack(id, data.cues, data.src, "");
    } else noCaptions("No German captions for this video — try another, or paste subtitles.");
  } catch (err) {
    noCaptions("Caption fetch failed: " + (err.message || err));
  }
}

/* ---------- YouGlish handoff ---------- */
YG.on("fetch", (e) => {
  $("q").value = e.query || $("q").value;
  // background auto-hear (roll/reroll) must not spam clip-count toasts
  if (!e.silent && e.totalResult) toast(e.totalResult + " clips for “" + e.query + "”", 2000);
});
YG.on("video", (e) => {
  captionRequest++;
  setCaptionStatus("");
  state.ygVideo = e.video || null;
  $("yg-playback-error").hidden = true;
  $("yg-playback-next").hidden = e.count < 2;
  $("yg-watch").href = "https://www.youtube.com/watch?v=" + encodeURIComponent(e.video);
  $("yg-empty").hidden = true;
  $("yg-actions").hidden = false;
  window.dispatchEvent(new CustomEvent("kl-clip-word", { detail: e.query }));
  $("yg-position").textContent = `Clip ${e.position} of ${e.count}`;
  $("yg-prev").disabled = e.count < 2;
  $("yg-next").disabled = e.count < 2;
  // hero banner tracks the active result clip (any index), not just the first
  if (state.ygVideo && $("hero-word").textContent && $("hero-word").textContent !== "…") {
    $("hero-thumb").style.background =
      "var(--hero-overlay), " +
      "url(\"https://i.ytimg.com/vi/" + state.ygVideo + "/hqdefault.jpg\") center/cover no-repeat";
    $("hero-thumb").hidden = false;
  }
});
YG.on("playbackError", (code) => {
  const message = code === 101 || code === 150
    ? "The owner disabled embedded playback for this clip."
    : code === 153
      ? "YouTube did not receive the site's referrer."
      : "YouTube could not play this clip here.";
  $("yg-playback-message").textContent = message + " (YouTube error " + code + ")";
  $("yg-playback-error").hidden = false;
});
$("yg-playback-next").addEventListener("click", () => YG.ygNext());

YG.on("caption", (e) => {
  state.ygCaption = (e.caption || "").replace(/\[\[\[|\]\]\]/g, "");
});

$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("q").value.trim();
  if (!q) return;
  document.querySelector('[data-tab="listen"]').click();
  YG.searchWord(q).catch((err) => toast((err && err.message) || "Search failed — one moment…", 4000));
});

$("yg-volume").addEventListener("input", (e) => {
  const volume = e.currentTarget.valueAsNumber;
  $("yg-volume-value").value = volume + "%";
  YG.ygSetVolume(volume);
});

$("yg-next").addEventListener("click", () => YG.ygNext());
$("yg-prev").addEventListener("click", () => YG.ygPrev());
$("yg-replay").addEventListener("click", () => YG.ygReplay());
$("yg-train").addEventListener("click", trainYgClip);
$("yg-try-next").addEventListener("click", () => YG.ygNext());

function setCaptionStatus(message, loading = false, failed = false) {
  $("yg-train").disabled = loading;
  $("yg-train").textContent = loading ? "Loading captions…" : "Start typing";
  $("yg-train-status").textContent = message;
  $("yg-try-next").hidden = !failed || $("yg-next").disabled;
}

async function trainYgClip() {
  const id = state.ygVideo;
  if (!id) return toast("No clip loaded yet — search first");
  const request = ++captionRequest;
  YG.ygPause();
  setCaptionStatus("Fetching German captions for this clip.", true);
  try {
    const cached = await dbGet(id);
    let cues = cached && cached.cues.length ? cached.cues : null;
    let src = cached ? cached.src : "";
    if (!cues) {
      const data = await fetchCues(id);
      if (!data || !data.cues.length) throw new Error("no German captions on that clip");
      cues = data.cues;
      src = data.src;
      indexPack(id, cues, src, "");
    }
    if (request !== captionRequest || $("view-home").hidden || $("panel-listen").hidden) return;
    setCaptionStatus("");
    const ci = state.ygCaption ? findCueByText(cues, state.ygCaption) : -1;
    openTrainer(id, cues, src, ci >= 0
      ? { ci, time: cues[ci].start, needle: state.ygCaption, dictate: true }
      : { dictate: true });
  } catch (err) {
    if (request === captionRequest) setCaptionStatus("Couldn't load German captions for this clip.", false, true);
  }
}

