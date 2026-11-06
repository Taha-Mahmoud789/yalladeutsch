import { normalize, gradeText, matchSpoken, splitSegments, chunkWords, chunkTimeRange, tidy, STRICT, DEF_OPTS } from "../core/dictation.js";
import { killCaptions } from "../services/youtube.js";
import { ygPause } from "../services/youglish.js";
import { speechSupported, listenOnce, startRecorder } from "../services/speech.js";
import { markWord } from "../data/store.js";
import { $, esc, fmt, toast } from "./dom.js";
import { bumpStats } from "./progress.js";

const setStats = (line, wpm, acc) => {
  if (line != null) $("st-line").textContent = line;
  if (wpm != null) $("st-wpm").textContent = "WPM " + wpm;
  if (acc != null) $("st-acc").textContent = "Acc " + acc + "%";
};
const lineLabel = (i, parts, chunk) =>
  i < 0 ? "Line –"
  : "Line " + (i + 1) + "/" + state.cues.length +
    (parts > 1 ? " · " + (chunk + 1) + "/" + parts : "");

const state = {
  videoId: null,
  cues: [],
  cur: -1,
  mode: "type",           // listen | type | shadow
  loop: false,
  pauseAtEnd: false,
  pauseAt: null,
  speed: 1,
  dictating: null,
  shadow: null,
  focus: null,
  wordLimit: +(localStorage.getItem("klWordLimit") || 0),
  cueOpen: false,
  afterLoad: null,
  segs: [],
  segRun: null,
  segTimer: null,
  segRes: false,
  strict: false,
};
const grOpts = () => (state.strict ? STRICT : DEF_OPTS);
let player = null, ticker = null;
let playerReady = false;
let attachTimer = null;

/* ================= TRAINER ================= */

function goHome() {
  clearInterval(attachTimer);
  cancelDict();
  cancelShadow();
  state.afterLoad = null;
  state.pauseAt = null;
  if (playerReady) player.pauseVideo();
  $("view-player").hidden = true;
  $("view-home").hidden = false;
  $("cap-src").textContent = "";
  window.scrollTo(0, 0);
}
$("brand").addEventListener("click", (e) => { e.preventDefault(); goHome(); });
$("back").addEventListener("click", goHome);

function syncCueList() {
  // Hearing only is the only hard hide. Dictation "active" no longer blocks the
  // side transcript — turning Hearing only off must bring it back immediately.
  $("cue-toggle").hidden = state.noCap;
  $("cue-list").hidden = state.noCap || !state.cueOpen;
}

$("cue-toggle").addEventListener("click", () => {
  state.cueOpen = !state.cueOpen;
  syncCueList();
});

/* hearing-only switch: transcript gone, type from audio alone */
state.noCap = localStorage.getItem("klNoCap") === "1";
$("nocap").checked = state.noCap;
$("nocap").addEventListener("change", (e) => {
  state.noCap = e.target.checked;
  localStorage.setItem("klNoCap", state.noCap ? "1" : "0");
  // turning off must bring the transcript back even if cueOpen was never flipped
  if (!state.noCap) state.cueOpen = true;
  toast(state.noCap ? "Hearing only — transcript hidden" : "Transcript available again", 1800);
  syncCueList();
  const input = $("dict-input");
  if (input) liveGrade(state.dictating);
  else if (!state.shadow && state.cur >= 0) renderCue(state.cur);
});

/* mode tabs */
document.querySelectorAll(".mode").forEach((m) => {
  m.addEventListener("click", () => setMode(m.dataset.mode));
});

function setMode(mode) {
  if (mode === "shadow" && !speechSupported()) {
    toast("Speech scoring needs Chrome or Edge — repeat after the video instead", 4500);
    return;
  }
  cancelDict();
  cancelShadow();
  state.mode = mode;
  document.querySelectorAll(".mode").forEach((x) =>
    x.classList.toggle("on", x.dataset.mode === mode)
  );
  $("current-cue").hidden = false;
  if (state.cur >= 0) renderCue(state.cur);
  if (mode === "type" && state.cur >= 0) startDictation(state.cur);
  if (mode === "shadow" && state.cur >= 0) startShadow(state.cur);
}

/* controls */
let typingStyle = localStorage.getItem("klTypingStyle") === "line" ? "line" : "word";

function setTypingStyle(style) {
  if (style === typingStyle) return;
  typingStyle = style;
  localStorage.setItem("klTypingStyle", style);
  const input = $("dict-input");
  const d = state.dictating;
  if (!input || !d || d.finished) return;
  if (style === "line" && d.entered.length) {
    input.value = d.entered.join(" ") + " " + input.value;
  }
  d.entered = [];
  input.dispatchEvent(new Event("input"));
  if (!d.finished) input.focus({ preventScroll: true });
}


$("replay").addEventListener("click", () => {
  const i = activeIndex();
  if (state.cues[i]) playCue(i);
});
$("prev-cue").addEventListener("click", () => {
  const i = Math.max(0, activeIndex() - 1);
  playCue(i);
});
$("next-cue").addEventListener("click", () => {
  const i = Math.min(state.cues.length - 1, activeIndex() + 1);
  playCue(i);
});
$("loop").addEventListener("click", () => {
  state.loop = !state.loop;
  $("loop").classList.toggle("on", state.loop);
  toast(state.loop ? "Loop ON" : "Loop OFF", 1200);
});
$("strict").checked = localStorage.getItem("klStrict") === "1";
state.strict = $("strict").checked;
$("strict").addEventListener("change", (e) => {
  state.strict = e.target.checked;
  localStorage.setItem("klStrict", e.target.checked ? "1" : "0");
  if ($("dict-input")) liveGrade(state.dictating);
  toast(state.strict ? "Strict: case & ß count" : "Relaxed grading", 1500);
});
$("word-limit").value = String(state.wordLimit);
$("word-limit").addEventListener("change", (e) => {
  state.wordLimit = +e.target.value;
  localStorage.setItem("klWordLimit", String(state.wordLimit));
  toast(state.wordLimit ? state.wordLimit + " words per typed part" : "Whole line per part", 1500);
  if (state.dictating && !state.dictating.finished) {
    const i = state.dictating.i;
    cancelDict();
    startDictation(i, 0);
  }
});
$("speed").addEventListener("change", (e) => {
  state.speed = +e.target.value;
  if (player && player.setPlaybackRate) player.setPlaybackRate(state.speed);
});

function activeIndex() {
  if (state.dictating) return state.dictating.i;
  if (state.shadow) return state.shadow.i;
  return state.cur >= 0 ? state.cur : 0;
}

/* ---------- open trainer ---------- */
export function openTrainer(id, cues, src, focus) {
  if (!id) return toast("Need the video URL — load it first");
  ygPause();
  clearInterval(attachTimer);
  state.videoId = id;
  state.cues = cues;
  state.cur = -1;
  state.focus = focus || null;
  state.segs = splitSegments(cues);
  state.segRun = null;
  state.segRes = false;
  state.pauseAt = null;
  state.afterLoad = null;
  state.mode = "type";
  clearTimeout(state.segTimer); state.segTimer = null;
  cancelDict();
  cancelShadow();
  document.querySelectorAll(".mode").forEach((x) =>
    x.classList.toggle("on", x.dataset.mode === "type")
  );
  $("view-home").hidden = true;
  $("view-player").hidden = false;
  window.scrollTo(0, 0);
  $("cap-src").textContent =
    (src === "auto" ? "auto-captions" : src === "pasted" ? "pasted captions" : "manual captions") +
    " · " + cues.length + " lines";
  buildCueList();
  $("current-cue").innerHTML = "";
  $("current-cue").hidden = false;
  updateSegbar();
  syncCueList();

  // focus first: attach()/onReady fire afterLoad synchronously or async
  if (focus && (focus.ci != null || focus.dictate)) {
    if (focus.dictate) {
      state.afterLoad = () => {
        state.afterLoad = null;
        setMode("type");
        const si = focus.ci == null ? 0 : segIndexOf(focus.ci);
        startSegment(si);
      };
    } else {
      state.afterLoad = () => {
        state.afterLoad = null;
        startDictation(focus.ci);
      };
    }
  }

  if (window.YT && YT.Player) attach(id);
  else {
    toast("Loading YouTube player…");
    attachTimer = setInterval(() => {
      if (window.YT && YT.Player) { clearInterval(attachTimer); attach(id); }
    }, 150);
  }
}

function attach(id) {
  if (player) {
    if (!playerReady) return;
    player.loadVideoById(id);
    player.playVideo();
    killCaptions(player);
    startTicker();
    if (state.afterLoad) state.afterLoad();
    return;
  }
  player = new YT.Player("player", {
    videoId: id,
    playerVars: { rel: 0, playsinline: 1, cc_load_policy: 0, iv_load_policy: 3 },
    events: {
      onReady: ({ target }) => {
        playerReady = true;
        if ($("view-player").hidden) return;
        killCaptions(player);
        player.setPlaybackRate(state.speed);
        if (state.videoId !== id) target.loadVideoById(state.videoId);
        else target.playVideo();
        startTicker();
        if (state.afterLoad) state.afterLoad();
      },
      onApiChange: () => killCaptions(player),
      onStateChange: (e) => {
        if (e.data !== 1) return;
        if ($("view-player").hidden) e.target.pauseVideo();
        else killCaptions(e.target);
      },
    },
  });
}

/* ---------- transcript list ---------- */
function buildCueList() {
  const list = $("cue-list");
  list.innerHTML = "";
  state.cues.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "cue";
    b.dataset.i = i;
    b.innerHTML = "<b>" + fmt(c.start) + "</b>" + esc(c.text);
    b.addEventListener("click", () => {
      if (state.mode === "type" && !state.segRun && !state.segRes && startDictation(i)) return;
      playCue(i);
    });
    list.appendChild(b);
  });
}

function playCue(i) {
  const c = state.cues[i];
  if (!c || !player || !player.seekTo) return;
  state.pauseAtEnd = true;
  player.seekTo(c.start, true);
  player.playVideo();
}

// Play only the current typing chunk (Easy/Medium/Hard), not the whole line.
function playChunk(d) {
  const c = state.cues[d.i];
  const range = chunkTimeRange(c, d.tw);
  if (!range || !player || !player.seekTo) return playCue(d.i);
  state.pauseAtEnd = false;
  state.pauseAt = range.to;
  player.seekTo(range.from, true);
  player.playVideo();
}

/* ---------- ticker: karaoke + loop + auto-pause ---------- */
function startTicker() { if (!ticker) ticker = setInterval(tick, 100); }

function tick() {
  if (!player || typeof player.getCurrentTime !== "function") return;
  const t = player.getCurrentTime();
  const dur = (typeof player.getDuration === "function" && player.getDuration()) || 0;
  $("st-time").textContent = fmt(t) + " / " + fmt(dur);

  const mode = state.dictating || state.shadow;
  if (mode) {
    const c = state.cues[mode.i];
    // chunk end (dictation parts) takes priority over full-cue end
    if (state.pauseAt != null && t >= state.pauseAt) {
      player.pauseVideo();
      state.pauseAt = null;
    } else if (state.pauseAtEnd && c && t >= c.start + c.dur) {
      player.pauseVideo();
      state.pauseAtEnd = false;
    }
    return;
  }

  const i = cueIndexAt(t);

  if (!state.segRes && i !== state.cur) {
    const prev = state.cur >= 0 ? state.cues[state.cur] : null;
    const hold = i < 0 && prev && t < prev.start + prev.dur + 0.7;
    if (!hold) {
      state.cur = i;
      renderCue(i);
      // typing is the main mode: hearing happens automatically inside dictation
      if (i >= 0 && state.mode === "type" && !state.segRun) startDictation(i);
    }
  }

  if (state.cur >= 0 && !state.segRes) highlightWord(t, state.cur);
  const c = state.cur >= 0 ? state.cues[state.cur] : null;
  if (c && t >= c.start + c.dur) {
    if (state.loop) player.seekTo(c.start, true);
    else if (state.pauseAtEnd) { player.pauseVideo(); state.pauseAtEnd = false; }
  }
  if (state.pauseAt != null && t >= state.pauseAt) {
    player.pauseVideo();
    state.pauseAt = null;
  }
}

function cueIndexAt(t) {
  const c = state.cues;
  if (!c.length) return -1;
  let lo = 0, hi = c.length - 1, res = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (c[m].start <= t) { res = m; lo = m + 1; } else hi = m - 1;
  }
  return res >= 0 && t >= c[res].start + c[res].dur ? -1 : res;
}

function renderCue(i) {
  const box = $("current-cue");
  if (i < 0) { box.innerHTML = ""; if (!state.dictating) setStats(lineLabel(-1)); return; }
  if (!state.dictating && !state.shadow) setStats(lineLabel(i));
  if (state.noCap && !state.dictating && !state.shadow) {
    box.textContent = "Hearing only · use Replay to hear the line again";
    return;
  }
  const n = state.focus ? normalize(state.focus.needle) : "";
  const isHit = (w) => {
    if (!n) return false;
    const wn = normalize(w.text);
    return wn === n || (n.length >= 4 && wn.includes(n));
  };
  box.replaceChildren();
  for (const w of state.cues[i].words) {
    const word = document.createElement("span");
    word.className = isHit(w) ? "w target" : "w";
    if (Number.isFinite(w.start)) word.dataset.s = String(w.start);
    word.textContent = w.text;
    if (box.childNodes.length) box.append(" ");
    box.append(word);
  }
  box.querySelectorAll(".w").forEach((el) => {
    el.addEventListener("click", () => {
      state.pauseAtEnd = true;
      player.seekTo(+el.dataset.s, true);
      player.playVideo();
    });
  });
  document.querySelectorAll(".cue.cur").forEach((e) => e.classList.remove("cur"));
  const btn = document.querySelector('.cue[data-i="' + i + '"]');
  if (btn) { btn.classList.add("cur"); btn.scrollIntoView({ block: "nearest" }); }
}

function highlightWord(t, i) {
  const ws = state.cues[i].words;
  let act = -1;
  for (let w = 0; w < ws.length; w++) if (ws[w].start <= t + 0.01) act = w;
  $("current-cue").querySelectorAll(".w").forEach((el, wi) =>
    el.classList.toggle("active", wi === act)
  );
}

/* ================= TYPE (dictation) ================= */
const UMLAUT_KEYS = { "1": "ä", "2": "ö", "3": "ü", "4": "ß" }; // umlaut pad buttons only — no key hijack (German layout)

// soft typing tick — Web Audio, no assets; very quiet sine blip
let _tickCtx;
function typeTick() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    _tickCtx = _tickCtx || new AC();
    const ctx = _tickCtx;
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 1400 + Math.random() * 300;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.025, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.09);
  } catch { /* audio blocked — ignore */ }
}

function cancelDict() {
  clearTimeout(state.segTimer);
  state.segTimer = null;
  state.segRun = null;
  state.segRes = false;
  state.pauseAt = null;
  if (!state.dictating) { updateSegbar(); return; }
  state.dictating = null;
  syncCueList();
  if (!$("view-player").hidden && state.cur >= 0) renderCue(state.cur);
  updateSegbar();
}

function startDictation(i, chunk = 0) {
  const c = state.cues[i];
  if (!c || !player || !player.seekTo) return toast("Pick a line from the transcript first");
  // real words only — junk tokens like "-" would shift every slot
  const all = c.words.filter((w) => normalize(w.text, grOpts()));
  if (!all.length) return toast("No typeable text in this line");
  // typing chunk size: 0 = whole line, else 5 / 7 / 10 words per part
  const parts = chunkWords(all, state.wordLimit);
  if (chunk >= parts.length) {
    if (i + 1 < state.cues.length) return startDictation(i + 1, 0);
    return toast("End of transcript");
  }
  const tw = parts[chunk];
  state.dictating = { i, chunk, chunks: parts.length, t0: 0, hints: new Set(), grades: {}, entered: [], finished: false, tw };
  setStats(lineLabel(i, parts.length, chunk), 0, 100);
  syncCueList();
  updateSegbar();
  renderDict();
  // multi-part → only this chunk's audio; whole line (Line mode) stays full cue
  if (parts.length > 1) playChunk(state.dictating);
  else playCue(i);
  return true;
}

const statText = (d, done) =>
  "Word " + (done + 1) + " of " + d.tw.length + " · Space = check · ↑ = replay · Enter = finish";

function renderDict() {
  const d = state.dictating;
  const box = $("current-cue");
  box.innerHTML = "";
  box.hidden = false;

  const sheet = document.createElement("div");
  sheet.className = "answer dict-answer";
  sheet.lang = "de";
  const showGhost = !state.noCap;
  d.slots = d.tw.map((w) => {
    const s = document.createElement("span");
    s.className = showGhost ? "w ghost" : "w slot";
    s.textContent = showGhost ? tidy(w.text) : "·".repeat(Math.max(2, w.text.length));
    sheet.appendChild(s);
    sheet.appendChild(document.createTextNode(" "));
    return s;
  });

  const status = document.createElement("div");
  status.className = "dict-status";
  const msg = document.createElement("span");
  msg.textContent = statText(d, 0);
  const hintBtn = document.createElement("button");
  hintBtn.className = "btn ghost mini";
  hintBtn.type = "button";
  hintBtn.textContent = "Reveal next word";
  hintBtn.addEventListener("click", hintWord);
  status.append(msg, document.createTextNode(" "), hintBtn);
  msg.setAttribute("role", "status");
  d.statEl = msg;
  d.hintBtn = hintBtn;

  const inp = document.createElement("input");
  inp.id = "dict-input";
  inp.className = "dict-input";
  inp.autocomplete = "off";
  inp.autocapitalize = "none";
  inp.spellcheck = false;
  inp.placeholder = "Type what you hear";
  inp.setAttribute("aria-label", "Type what you hear");
  inp.lang = "de";
  inp.addEventListener("input", (event) => {
    if (event.isComposing) return;
    if (!d.t0) d.t0 = Date.now();
    if (d.finished) return;
    const parts = inp.value.split(/\s+/);
    const pending = parts.pop();
    if (typingStyle === "line") d.entered = [];
    else inp.value = pending;
    for (const word of parts) {
      if (typingStyle === "word" && d.entered.length >= d.tw.length) break;
      if (normalize(word, grOpts())) d.entered.push(word);
    }
    liveGrade(d, pending);
    if (d.entered.length === d.tw.length &&
        (typingStyle === "word" || (!pending && Object.values(d.grades).every((grade) => grade === "ok" || grade === "hint")))) finishDict();
  });
  inp.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (typingStyle === "word" && e.key === "Backspace" && !inp.value && d.entered.length) {
      e.preventDefault();
      d.hints.delete(d.entered.length - 1);
      inp.value = d.entered.pop();
      liveGrade(d, inp.value);
      return;
    }
    if (e.key === "ArrowUp") { e.preventDefault(); playChunk(d); }
    else if (e.key === "Enter") { e.preventDefault(); finishDict(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeTick();
  });

  // umlaut pad (mobile + discoverability)
  const kbd = document.createElement("div");
  kbd.className = "kbd-help";
  for (const [k, ch] of Object.entries(UMLAUT_KEYS)) {
    const b = document.createElement("button");
    b.className = "kbd";
    b.type = "button";
    b.textContent = ch;
    b.title = "key " + k;
    b.addEventListener("click", () => {
      inp.setRangeText(ch, inp.selectionStart, inp.selectionEnd, "end");
      inp.dispatchEvent(new Event("input"));
      inp.focus();
    });
    kbd.appendChild(b);
  }

  const styles = document.createElement("div");
  styles.className = "typing-styles";
  styles.setAttribute("role", "group");
  styles.setAttribute("aria-label", "Typing style");
  for (const [style, label] of [["word", "Word by word"], ["line", "Full line"]]) {
    const button = document.createElement("button");
    button.className = "btn ghost";
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(style === typingStyle));
    button.addEventListener("click", () => {
      setTypingStyle(style);
      for (const item of styles.children) item.setAttribute("aria-pressed", String(item === button));
    });
    styles.appendChild(button);
  }

  box.append(sheet, status, kbd, styles, inp);
  liveGrade(d);
  inp.focus({ preventScroll: true });
}

function liveGrade(d, pending = $("dict-input")?.value.split(/\s+/).at(-1) || "") {
  const done = Math.min(d.entered.length, d.tw.length);
  const g = gradeText(d.tw.slice(0, done).map((w) => w.text), d.entered, grOpts(), true);
  for (let i = 0; i < d.tw.length; i++) {
    const slot = d.slots[i];
    if (i < done) {
      if (g.words[i].status !== "ok") d.hints.delete(i);
      d.grades[i] = d.hints.has(i) ? "hint" : g.words[i].status;
      slot.className = "w " + d.grades[i];
      slot.textContent = d.entered[i];
      if (typingStyle === "line" && !state.noCap && ["wrong", "typo"].includes(d.grades[i])) {
        const correction = document.createElement("small");
        correction.className = "word-correction";
        correction.textContent = tidy(d.tw[i].text);
        slot.appendChild(correction);
      }
    } else {
      delete d.grades[i];
      d.hints.delete(i);
      slot.className = state.noCap ? "w slot" : "w ghost";
      slot.textContent = state.noCap ? "·".repeat(Math.max(2, d.tw[i].text.length)) : tidy(d.tw[i].text);
    }
  }
  d.slots[done]?.classList.add("current");
  if (d.slots[done] && pending && !state.noCap) {
    const slot = d.slots[done];
    const letters = Array.from(tidy(d.tw[done].text));
    const options = { ...grOpts(), sentence: false };
    const typed = normalize(pending, options);
    let visible = 0;
    for (let i = 1; i <= letters.length; i++) {
      if (!typed.startsWith(normalize(letters.slice(0, i).join(""), options))) break;
      visible = i;
    }
    const hidden = document.createElement("span");
    hidden.className = "word-hidden";
    hidden.textContent = letters.slice(visible).join("");
    slot.replaceChildren(letters.slice(0, visible).join(""), hidden);
  }
  d.statEl.textContent = done === d.tw.length ? "Edit a word or press Enter to finish" : statText(d, done);
  if (d.t0) {
    const seconds = (Date.now() - d.t0) / 1000;
    const wpm = seconds > 0.4 ? Math.min(200, Math.round(done * 60 / seconds)) : 0;
    setStats(null, wpm, done ? Math.round(g.ok * 100 / done) : 100);
  }
}

function hintWord() {
  const d = state.dictating;
  if (!d || d.finished) return;
  const inp = $("dict-input");
  const next = d.entered.length;
  if (next >= d.tw.length) return;
  d.hints.add(next);
  const prefix = typingStyle === "line" && next ? d.entered.join(" ") + " " : "";
  inp.value = prefix + tidy(d.tw[next].text) + " ";
  inp.dispatchEvent(new Event("input"));
  if (!d.finished) inp.focus({ preventScroll: true });
}

function finishDict() {
  const d = state.dictating;
  if (!d || d.finished) return;
  d.finished = true;
  const c = state.cues[d.i];
  const tokens = d.entered.slice();
  const pending = $("dict-input")?.value.split(/\s+/).at(-1);
  if (pending && normalize(pending, grOpts()) && (typingStyle === "line" || tokens.length < d.tw.length)) tokens.push(pending);
  const texts = d.tw.map((w) => w.text);
  const g = gradeText(texts, tokens, grOpts(), typingStyle === "word");
  g.words.forEach((word, index) => {
    if (word.status === "ok" && d.hints.has(word.typedIndex ?? index)) word.status = "hint";
  });

  const sheet = $("current-cue").querySelector(".answer");
  sheet.replaceChildren();
  g.words.forEach((w) => {
    const s = document.createElement("span");
    s.className = "w " + w.status;
    s.textContent = tidy(w.raw || "") || w.typed || "";
    sheet.appendChild(s);
    sheet.appendChild(document.createTextNode(" "));
  });
  const inpEl = $("dict-input");
  if (inpEl) inpEl.remove();
  $("current-cue").querySelector(".typing-styles")?.remove();
  document.querySelector("#current-cue .kbd-help")?.remove();
  if (d.hintBtn) d.hintBtn.remove();

  const acc = Math.round((g.ok * 100) / (texts.length || 1));
  const elapsedMs = Math.max(600, d.t0 ? Date.now() - d.t0 : 600);
  const wpm = Math.round((tokens.length / Math.max(elapsedMs, 1000)) * 60000);
  bumpStats("dictation");
  for (const w of g.words) {
    if (!w.raw || w.status === "extra") continue;
    markWord(
      { w: tidy(w.raw), v: state.videoId, t: c.start, ctx: tidy(c.text) },
      w.status === "ok" || w.status === "typo" || w.status === "hint" ? "pass" : "fail"
    );
  }

  const st = d.statEl;
  st.textContent =
    g.ok + "/" + texts.length + " exact · " + g.typos + " typo · " + g.missed + " missed · " + g.extra + " extra" +
    " · " + acc + "% · " + Math.min(wpm, 200) + " wpm";
  setStats(null, Math.min(wpm, 200), acc);

  // segment run auto-advance
  if (state.segRun) {
    const run = state.segRun, seg = state.segs[run.si];
    if ($("dict-input")) $("dict-input").remove();
    document.querySelector("#current-cue .kbd-help")?.remove();
    if (d.hintBtn) d.hintBtn.remove();
    run.results.push({ i: d.i, acc, wpm, ok: g.ok, n: texts.length });
    run.done++;
    run.ms += elapsedMs;
    run.words += tokens.length;
    updateSegbar();
    const moreChunk = (d.chunk || 0) + 1 < (d.chunks || 1);
    if (moreChunk || d.i + 1 <= seg.ci1) {
      st.textContent += " — next…";
      state.segTimer = setTimeout(() => {
        state.segTimer = null;
        if (state.segRun) {
          if (moreChunk) startDictation(d.i, d.chunk + 1);
          else startDictation(d.i + 1, 0);
        }
      }, 1500);
    } else {
      st.textContent += " — segment complete…";
      state.segTimer = setTimeout(() => {
        state.segTimer = null;
        if (state.segRun) segmentDone();
      }, 1200);
    }
    return;
  }

  // same-line parts flow as one action: auto-advance, no "Next part" click
  const moreChunk = (d.chunk || 0) + 1 < (d.chunks || 1);
  if (moreChunk) {
    st.textContent += " — next part…";
    setTimeout(() => { if (!state.segRun && !state.shadow) startDictation(d.i, d.chunk + 1); }, 900);
    return;
  }

  // single-line: offer shadow next (the learning loop)
  const row = document.createElement("div");
  row.className = "score-btns";
  const mk = (label, fn, primary) => {
    const b = document.createElement("button");
    b.className = primary ? "btn cyan mini" : "btn ghost mini";
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", fn);
    row.appendChild(b);
  };
  mk("Replay", () => (d.chunks > 1 ? playChunk(d) : playCue(d.i)));
  mk("Retry", () => startDictation(d.i, d.chunk || 0));
  if (speechSupported()) mk("Say it → shadow", () => setMode("shadow") || startShadow(d.i), true);
  mk(d.i + 1 < state.cues.length ? "Next line →" : "Pick from transcript",
    () => {
      if (d.i + 1 < state.cues.length) startDictation(d.i + 1, 0);
      else { state.cueOpen = true; syncCueList(); }
    });
  st.parentElement.appendChild(row);
  syncCueList();
}

/* ---------- segment runs ---------- */
function segIndexOf(ci) {
  for (let k = 0; k < state.segs.length; k++) {
    const s = state.segs[k];
    if (ci >= s.ci0 && ci <= s.ci1) return k;
  }
  return state.segs.length ? state.segs.length - 1 : 0;
}

function updateSegbar() {
  const n = state.segs.length;
  const track = $("seg-track");
  if (!n) {
    $("seg-run").hidden = true;
    $("seg-exit").hidden = true;
    track.innerHTML = "";
    return;
  }
  const run = state.segRun;
  const cur = run ? run.si : state.cur >= 0 ? segIndexOf(state.cur) : -1;
  $("seg-frac").textContent =
    cur < 0 ? "Segment –" :
    "Segment " + (cur + 1) + "/" + n + (run ? " · " + run.done + "/" + run.total : "");
  if (track.children.length !== n) {
    track.innerHTML = Array.from({ length: n }, () => "<i></i>").join("");
  }
  [...track.children].forEach((el, i) => {
    el.className = i < (run ? run.si : cur) ? "done" : i === (run ? run.si : cur) ? "cur" : "";
  });
  $("seg-run").hidden = !!run;
  $("seg-exit").hidden = !run;
}

function startSegment(si) {
  const s = state.segs[si];
  if (!s || !state.cues.length) return;
  cancelDict();
  cancelShadow();
  if (state.mode !== "type") {
    state.mode = "type";
    document.querySelectorAll(".mode").forEach((x) =>
      x.classList.toggle("on", x.dataset.mode === "type")
    );
  }
  state.segRun = { si, results: [], done: 0, total: segChunkTotal(s.ci0, s.ci1), ms: 0, words: 0 };
  updateSegbar();
  startDictation(s.ci0, 0);
}

function segChunkTotal(ci0, ci1) {
  let n = 0;
  for (let i = ci0; i <= ci1; i++) {
    const all = (state.cues[i].words || []).filter((w) => normalize(w.text, grOpts()));
    n += chunkWords(all, state.wordLimit).length;
  }
  return n || 1;
}

$("seg-run").addEventListener("click", () =>
  startSegment(state.cur >= 0 ? segIndexOf(state.cur) : 0)
);
$("seg-exit").addEventListener("click", exitRun);

function exitRun() {
  state.segRes = false;
  state.segRun = null;
  state.dictating = null;
  clearTimeout(state.segTimer); state.segTimer = null;
  syncCueList();
  if (!$("view-player").hidden && state.cur >= 0) renderCue(state.cur);
  updateSegbar();
}

function saveBest(vid, acc, wpm) {
  if (!vid) return false;
  const b = (() => { try { return JSON.parse(localStorage.getItem("klBests") || "{}"); } catch { return {}; } })();
  const v = b[vid] || (b[vid] = { acc: 0, wpm: 0 });
  let better = false;
  if (acc > v.acc) { v.acc = acc; better = true; }
  if (wpm > v.wpm) { v.wpm = Math.min(wpm, 200); better = true; }
  localStorage.setItem("klBests", JSON.stringify(b));
  return better;
}

function segmentDone() {
  const run = state.segRun;
  const seg = state.segs[run.si];
  const n = run.results.reduce((a, r) => a + r.n, 0) || 1;
  const ok = run.results.reduce((a, r) => a + r.ok, 0);
  const acc = Math.round((ok * 100) / n);
  const wpm = Math.round((run.words / Math.max(run.ms, 1000)) * 60000);
  const best = saveBest(state.videoId, acc, wpm);
  const pb = (() => {
    try { return JSON.parse(localStorage.getItem("klBests") || "{}")[state.videoId] || {}; } catch { return {}; }
  })();

  $("current-cue").hidden = false;
  $("current-cue").innerHTML = "";
  const p = document.createElement("div");
  p.className = "seg-res";
  const rows = run.results
    .map(
      (r) =>
        "<div class='seg-row'>line " + (r.i - seg.ci0 + 1) + " — " + r.acc + "% · " +
        Math.min(r.wpm, 200) + " wpm</div>"
    )
    .join("");
  p.innerHTML =
    "<div class='seg-head'>Segment " + (run.si + 1) + "/" + state.segs.length + " complete</div>" +
    "<div class='seg-score'>" + ok + "/" + n + " exact · " + acc + "% · " +
    Math.min(wpm, 200) + " wpm" +
    (best ? " · <b>new best</b>" : "") +
    " <span class='pb-hint'>(pb " + (pb.acc || 0) + "% · " + (pb.wpm || 0) + ")</span></div>" + rows;

  const bar = document.createElement("div");
  bar.className = "score-btns";
  const mk = (label, fn, primary) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = primary ? "btn primary" : "btn ghost mini";
    b.textContent = label;
    b.addEventListener("click", fn);
    bar.appendChild(b);
    return b;
  };
  mk("Replay segment ▸", () => playSeg(run.si));
  mk("Retry segment", () => startSegment(run.si));
  const next = mk(
    run.si + 1 < state.segs.length ? "Next segment →" : "Done",
    () => (run.si + 1 < state.segs.length ? startSegment(run.si + 1) : (state.segRes = false, exitRun())),
    true
  );
  $("current-cue").append(p, bar);
  next.focus({ preventScroll: true });
  state.segRes = true;
  syncCueList();
}

function playSeg(si) {
  const s = state.segs[si];
  if (!s) return;
  state.pauseAt = s.end + 0.6;
  state.pauseAtEnd = false;
  player.seekTo(s.start, true);
  player.playVideo();
}

/* ================= SHADOW ================= */
const PASS = 0.9; // ponytail: fixed 90%; sliders when asked

function cancelShadow() {
  if (!state.shadow) return;
  const s = state.shadow;
  if (s.audioUrl) { URL.revokeObjectURL(s.audioUrl); s.audioUrl = null; }
  state.shadow = null;
  syncCueList();
}

function startShadow(i) {
  const c = state.cues[i];
  if (!c) return toast("Pick a line from the transcript first");
  cancelDict();
  if (!speechSupported()) {
    toast("Speech scoring needs Chrome or Edge — loop + 0.75× help for shadowing", 4500);
    return;
  }
  cancelShadow();
  const tw = c.words.filter((w) => normalize(w.text, grOpts()));
  if (!tw.length) return toast("No typeable text in this line");
  state.shadow = { i, busy: false, attempts: 0, take: null, audioUrl: null, tw };
  setStats(lineLabel(i), null, null);
  syncCueList();
  renderShadow();
  playCue(i);
}

function renderShadow() {
  const s = state.shadow;
  const box = $("current-cue");
  box.innerHTML = "";
  box.hidden = false;

  const sheet = document.createElement("div");
  sheet.className = "answer";
  s.chips = s.tw.map((w) => {
    const el = document.createElement("span");
    el.className = "w slot spoken";
    el.textContent = tidy(w.text);
    sheet.appendChild(el);
    sheet.appendChild(document.createTextNode(" "));
    return el;
  });

  const status = document.createElement("div");
  status.className = "dict-status";
  const msg = document.createElement("span");
  msg.textContent = "Attempt 0 · listen to the model, then say the sentence";
  status.appendChild(msg);
  s.statEl = msg;

  const mic = document.createElement("button");
  mic.className = "btn speak";
  mic.type = "button";
  mic.textContent = "🎤 Mic: say it now";
  mic.addEventListener("click", shadowAttempt);
  s.micBtn = mic;

  const actions = document.createElement("div");
  actions.className = "score-btns";
  const mk = (label, fn) => {
    const b = document.createElement("button");
    b.className = "btn ghost mini";
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", fn);
    actions.appendChild(b);
    return b;
  };
  mk("Original ▶", () => playCue(s.i));
  const takeBtn = mk("Your take ▶", playTake);
  takeBtn.disabled = true;
  s.takeBtn = takeBtn;
  mk("Try again", resetShadowAttempt);
  const nextBtn = mk("Next line →", () => {
    if (s.i + 1 < state.cues.length) startShadow(s.i + 1);
    else { cancelShadow(); toast("Pick any line from the transcript"); }
  });
  nextBtn.hidden = true;
  nextBtn.className = "btn cyan mini";
  s.nextBtn = nextBtn;

  box.append(sheet, status, mic, actions);
}

async function shadowAttempt() {
  const s = state.shadow;
  if (!s || s.busy) return;
  s.busy = true;
  s.micBtn.disabled = true;
  s.micBtn.classList.add("listening");
  s.micBtn.textContent = "● listening…";
  let rec = null;
  try {
    rec = await startRecorder();
    const said = await listenOnce("de-DE", 10000);
    const take = await rec.stop();
    rec = null;
    s.attempts++;
    const m = matchSpoken(s.tw.map((w) => w.text), said.split(/\s+/));
    if (s.audioUrl) URL.revokeObjectURL(s.audioUrl);
    s.audioUrl = URL.createObjectURL(take);
    s.takeBtn.disabled = false;
    s.chips.forEach((el, i) => {
      const w = m.words[i];
      el.className = "w spoken " + (w ? w.status : "extra");
    });
    const pass = m.ratio >= PASS;
    s.statEl.textContent =
      Math.round(m.ratio * 100) + "% · attempt " + s.attempts +
      (pass ? " — passed ✓ one more rep for muscle memory?" : " — listen once more, then try again");
    s.nextBtn.hidden = !pass;
    const c = state.cues[s.i];
    const metas = s.tw.map((w) => ({ w: tidy(w.text), v: state.videoId, t: c.start, ctx: tidy(c.text) }));
    for (const w of m.words) {
      const meta = metas[w.k];
      if (!meta) continue;
      markWord(meta, w.status !== "missed" && pass ? "pass" : "fail");
    }
    bumpStats("shadow");
  } catch (e) {
    s.statEl.textContent = "Error: " + (e.message || e) + " — press the mic again";
  } finally {
    if (rec) { try { await rec.stop(); } catch { /* best effort */ } }
    if (state.shadow === s) {
      s.busy = false;
      s.micBtn.disabled = false;
      s.micBtn.classList.remove("listening");
      s.micBtn.textContent = "🎤 Mic: say it now";
    }
  }
}

function playTake() {
  const s = state.shadow;
  if (!s || !s.audioUrl) return;
  let a = document.getElementById("shadow-audio");
  if (!a) {
    a = document.createElement("audio");
    a.id = "shadow-audio";
    a.style.display = "none";
    document.body.appendChild(a);
  }
  a.src = s.audioUrl;
  a.play();
}

function resetShadowAttempt() {
  const s = state.shadow;
  if (!s || s.busy) return;
  s.chips.forEach((el) => { el.className = "w slot spoken"; });
  s.nextBtn.hidden = true;
  s.statEl.textContent = "Attempt " + s.attempts + " · listen, then say it";
  playCue(s.i);
}

