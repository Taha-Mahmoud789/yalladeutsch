// klanger — dictation engine (pure, testable via test.html).

export const DEF_OPTS = { lower: true, ss: true, umlaut: true, punct: true };

// Strict German: case and ß must match exactly; punctuation and ae/oe/ue folds stay.
export const STRICT = { lower: false, ss: false, umlaut: true, punct: true };

// caption junk (arrows, dashes, brackets) vs sentence punctuation (counts when typing)
const JUNK = /[\u2018\u2019\u201A"'`\u2027!?:;\-()\[\]{}/\u2013\u2014\u00ab\u00bb\u201e\u201c\u201d\u2026<>]+/g;
const SENT = /[.,]+/g;

export function normalize(s, o = DEF_OPTS) {
  let t = String(s || "").normalize("NFC");
  if (o.punct !== false) t = t.replace(JUNK, "");
  if (o.sentence !== false) t = t.replace(SENT, "");
  if (o.lower !== false) t = t.toLowerCase();
  if (o.umlaut !== false) t = t.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue");
  if (o.ss !== false) t = t.replace(/ß/g, "ss");
  t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return t.replace(/\s+/g, " ").trim();
}

// Display form: drop caption junk, keep , and . — what you should type.
export function tidy(s) {
  return String(s || "").replace(JUNK, "").replace(/\s+/g, " ").trim();
}

// Split typeable words into typing chunks. limit 0 / oversize → single part (current behaviour).
export function chunkWords(words, limit) {
  if (!limit || limit <= 0 || words.length <= limit) return [words];
  const out = [];
  for (let i = 0; i < words.length; i += limit) out.push(words.slice(i, i + limit));
  return out;
}

// Estimated start for every word: ASR stamps one time per segment (several
// words share .start). Split each segment's span across its words by length
// so a mid-segment chunk doesn't start at the segment head (previous word).
// Junk tokens ("-") take zero width — a time slice for them opens a gap
// between adjacent typeable chunks and the next seek starts mid-word.
function estimateWordStarts(cue) {
  const all = cue.words;
  const n = all.length;
  const starts = new Array(n);
  const cueEnd = cue.start + cue.dur;
  let g = 0;
  while (g < n) {
    let e = g;
    while (e + 1 < n && all[e + 1].start === all[g].start) e++;
    const segStart = all[g].start;
    const segEnd = e + 1 < n ? all[e + 1].start : cueEnd;
    let total = 0;
    for (let i = g; i <= e; i++) if (normalize(all[i].text)) total += Math.max(1, all[i].text.length);
    if (!total) total = 1;
    let acc = 0;
    const span = Math.max(0, segEnd - segStart);
    for (let i = g; i <= e; i++) {
      if (normalize(all[i].text)) {
        starts[i] = segStart + (acc / total) * span;
        acc += Math.max(1, all[i].text.length);
      } else {
        starts[i] = acc ? segStart + (acc / total) * span : segStart;
      }
    }
    g = e + 1;
  }
  return starts;
}

// Audio range for a typing chunk: first word → where the next typeable word
// begins. Lead/trail pad so a slightly-late estimate still catches the word
// onset/offset (char-weight ≠ speech rate; ~1 word of drift is the ceiling).
const CHUNK_LEAD = 0.2;
const CHUNK_TRAIL = 0.3;

export function chunkTimeRange(cue, words) {
  if (!cue || !words || !words.length) return null;
  const all = cue.words;
  const i0 = all.indexOf(words[0]);
  const i1 = all.indexOf(words[words.length - 1]);
  if (i0 < 0 || i1 < i0) return { from: cue.start, to: cue.start + cue.dur };
  const starts = estimateWordStarts(cue);
  const cueEnd = cue.start + cue.dur;
  let j = i1 + 1;
  while (j < all.length && !normalize(all[j].text)) j++;
  const rawFrom = starts[i0];
  const rawTo = j < all.length ? starts[j] : cueEnd;
  const from = Math.max(cue.start, rawFrom - CHUNK_LEAD);
  let to = Math.min(cueEnd, rawTo + CHUNK_TRAIL);
  if (to < from + 0.2) to = Math.min(cueEnd, from + 0.2);
  return { from, to };
}

export function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) prev[i] = i;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function ratio(a, b) {
  const L = Math.max(a.length, b.length) || 1;
  return 1 - lev(a, b) / L;
}

// Align submitted lines so omitted or extra words do not shift every later grade.
export function gradeText(target, typed, opts = DEF_OPTS, positional = false) {
  // typing counts , and . ; junk-only tokens ("-") drop so word slots stay aligned.
  const so = { ...opts, sentence: false };
  const t = [];
  for (const w of target) { const n = normalize(w, so); if (n) t.push({ raw: w, n }); }
  const y = [];
  for (const w of typed) { const n = normalize(w, so); if (n) y.push(n); }
  const words = [];
  let ok = 0, typos = 0, missed = 0, extra = 0;
  const n = Math.max(t.length, y.length);
  if (!positional) {
    const cost = Array.from({ length: t.length + 1 }, () => new Array(y.length + 1));
    for (let i = t.length; i >= 0; i--) {
      for (let j = y.length; j >= 0; j--) {
        cost[i][j] = i === t.length ? y.length - j : j === y.length ? t.length - i :
          Math.min(cost[i + 1][j] + 1, cost[i][j + 1] + 1, cost[i + 1][j + 1] + Number(t[i].n !== y[j]));
      }
    }
    let i = 0, j = 0;
    while (i < t.length || j < y.length) {
      const exact = i < t.length && j < y.length && t[i].n === y[j];
      if (!exact && i < t.length && cost[i][j] === cost[i + 1][j] + 1) {
        words.push({ status: "missed", raw: t[i++].raw });
        missed++;
      } else if (!exact && j < y.length && cost[i][j] === cost[i][j + 1] + 1) {
        words.push({ status: "extra", typed: y[j], typedIndex: j++ });
        extra++;
      } else {
        const status = exact ? "ok" : ratio(t[i].n, y[j]) >= 0.8 ? "typo" : "wrong";
        words.push({ status, raw: t[i++].raw, typed: y[j], typedIndex: j++ });
        if (exact) ok++;
        else if (status === "typo") typos++;
      }
    }
    return { words, ok, typos, missed, extra };
  }
  for (let i = 0; i < n; i++) {
    if (i >= y.length) { missed++; words.push({ status: "missed", raw: t[i].raw }); continue; }
    if (i >= t.length) { extra++; words.push({ status: "extra", typed: y[i] }); continue; }
    if (t[i].n === y[i]) { ok++; words.push({ status: "ok", raw: t[i].raw, typed: y[i] }); }
    else if (ratio(t[i].n, y[i]) >= 0.8) { typos++; words.push({ status: "typo", raw: t[i].raw, typed: y[i] }); }
    else words.push({ status: "wrong", raw: t[i].raw, typed: y[i] });
  }
  return { words, ok, typos, missed, extra };
}

// Corpus/cue search. Single word: exact token or substring (len>=4). Phrase: substring.
// ponytail: O(corpus) scan per query — fine for a personal corpus; inverted index if slow.
export function matchCues(cues, q) {
  const n = normalize(q);
  if (!n) return [];
  const out = [];
  for (let ci = 0; ci < cues.length; ci++) {
    const c = cues[ci];
    if (n.includes(" ")) {
      if (normalize(c.text).includes(n)) out.push({ ci, wi: [] });
      continue;
    }
    const wi = [];
    for (let k = 0; k < c.words.length; k++) {
      const w = normalize(c.words[k].text);
      if (w === n) wi.push(k);
      else if (n.length >= 4 && w.includes(n)) wi.push(k);
    }
    if (wi.length) out.push({ ci, wi });
  }
  return out;
}

// Home roulette: one row, uniform over videos (not cue hits).
// avoidVid: skip that video when the word has another (same word re-roll → new clip).
export function pickVideoRow(rows, avoidVid) {
  if (!rows || !rows.length) return null;
  const byVid = new Map();
  for (const r of rows) {
    const id = r.p.id;
    if (!byVid.has(id)) byVid.set(id, []);
    byVid.get(id).push(r);
  }
  let ids = [...byVid.keys()];
  if (avoidVid && ids.length > 1) ids = ids.filter((id) => id !== avoidVid);
  const vid = ids[(Math.random() * ids.length) | 0];
  const pool = byVid.get(vid);
  return pool[(Math.random() * pool.length) | 0];
}

// Pronunciation scoring: every target word back from ASR? Order-insensitive greedy match.
export function matchSpoken(expected, said, opts = DEF_OPTS) {
  const E = expected.map((w, k) => ({ raw: w, n: normalize(w, opts), k })).filter((w) => w.n);
  const S = said.map((t) => normalize(t, opts)).filter(Boolean);
  const used = new Array(S.length).fill(false);
  const words = E.map((e) => {
    let best = -1, bestR = 0;
    for (let i = 0; i < S.length; i++) {
      if (used[i]) continue;
      if (S[i] === e.n) { best = i; bestR = 1; break; }
      const r = ratio(e.n, S[i]);
      if (r >= 0.8 && r > bestR) { best = i; bestR = r; }
    }
    if (best >= 0) { used[best] = true; return { raw: e.raw, k: e.k, status: bestR === 1 ? "ok" : "typo" }; }
    return { raw: e.raw, k: e.k, status: "missed" };
  });
  const matched = words.filter((w) => w.status !== "missed").length;
  return { words, matched, total: E.length, ratio: E.length ? matched / E.length : 0 };
}

// Segment runs: split cues into <=16 chunks ~35s each. Pure for tests.
export function splitSegments(cues, max = 16, targetSecs = 35) {
  if (!cues.length) return [];
  const totalDur = cues[cues.length - 1].start + cues[cues.length - 1].dur;
  const n = Math.min(max, Math.max(1, Math.round(totalDur / targetSecs)));
  const per = Math.ceil(cues.length / n);
  const segs = [];
  for (let ci0 = 0; ci0 < cues.length; ci0 += per) {
    const ci1 = Math.min(ci0 + per, cues.length) - 1;
    segs.push({ ci0, ci1, start: cues[ci0].start, end: cues[ci1].start + cues[ci1].dur });
  }
  return segs;
}
