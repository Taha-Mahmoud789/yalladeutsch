import assert from "node:assert/strict";
import { parseVideoId, json3ToCues, subToCues, findCueByText } from "../src/services/youtube.js";
import { normalize, lev, ratio, gradeText, tidy, DEF_OPTS, STRICT, matchCues, matchSpoken, splitSegments, chunkWords, chunkTimeRange, pickVideoRow } from "../src/core/dictation.js";
import { markWord, dueWords, loadWords, saveWords, streakNext, intervalDays, importAll } from "../src/data/store.js";
import { relay } from "../src/server/relay.js";
import { parseYgResults, ygStartIndex } from "../src/services/youglish.js";
import { B1_WORDS } from "../src/core/words.js";

const storage = new Map();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
});

const ok = (name, condition) => assert.ok(condition, name);

// ---- parseVideoId ----
ok("watch url", parseVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ") === "dQw4w9WgXcQ");
ok("short url", parseVideoId("https://youtu.be/dQw4w9WgXcQ") === "dQw4w9WgXcQ");
ok("shorts url", parseVideoId("https://www.youtube.com/shorts/abcdefghijk") === "abcdefghijk");
ok("raw id", parseVideoId("abcdefghijk") === "abcdefghijk");
ok("extra params", parseVideoId("https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ&t=42") === "dQw4w9WgXcQ");
ok("garbage -> null", parseVideoId("hello world") === null);

// ---- json3ToCues ----
const j3 = { events: [
  { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "Hallo\n" }, { utf8: "Welt", tOffsetMs: 300 }] },
  { tStartMs: 4000, dDurationMs: 1000, aAppend: 1, segs: [{ utf8: "Anhängsel\n" }] },
  { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: "\n" }] },
  { tStartMs: 4000, dDurationMs: 1500, segs: [{ utf8: "Zweitzeile\n" }] },
]};
const cues = json3ToCues(j3);
ok("json3 cue count (aAppend+blank skipped)", cues.length === 2);
ok("json3 first text", cues[0].text === "Hallo Welt");
ok("json3 word timing", Math.abs(cues[0].words[1].start - 1.3) < 0.01);
ok("json3 sorted", cues[0].start < cues[1].start);

// ---- subToCues ----
const srt = "1\n00:00:01,000 --> 00:00:03,500\nHallo Welt\n\n2\n00:00:04,000 --> 00:00:06,000\nGuten Tag\n";
const sc = subToCues(srt);
ok("srt two cues", sc.length === 2);
ok("srt start", Math.abs(sc[0].start - 1) < 0.01);
ok("srt text", sc[1].text === "Guten Tag");

// ---- normalize / STRICT ----
ok("lower fold", normalize("HALLO") === "hallo");
ok("umlaut fold", normalize("Straße") === "strasse" || normalize("Straße") === "strasse");
ok("ß->ss", normalize("größer") === "groesser");
ok("strict keeps case", normalize("Haus", STRICT) === "Haus");
ok("strict keeps ß", normalize("Straße", STRICT) === "Straße");
ok("punct strip", normalize("Hallo, Welt!") === "hallo welt");

// ---- lev / ratio ----
ok("lev identical", lev("abc", "abc") === 0);
ok("lev one sub", lev("abc", "abd") === 1);
ok("ratio high", ratio("schon", "schon") === 1);
ok("ratio close", ratio("Haus", "Maus") >= 0.6);

// ---- gradeText ----
const g = gradeText(["Guten", "Tag"], ["Guten", "Tag"]);
ok("grade exact", g.ok === 2 && g.typos === 0 && g.missed === 0);
const g2 = gradeText(["Guten", "Tag"], ["Guton", "Tag"]);
ok("grade typo", g2.typos === 1 && g2.ok === 1);
const g3 = gradeText(["Guten", "Tag"], ["Guten"]);
ok("grade missed", g3.missed === 1);
const skipped = gradeText(["Ich", "lerne", "heute", "Deutsch"], ["Ich", "heute", "Deutsch"]);
ok("grade realigns after an omitted word", skipped.ok === 3 && skipped.words[1].status === "missed");
const inserted = gradeText(["Ich", "lerne", "Deutsch"], ["Ich", "auch", "lerne", "Deutsch"]);
ok("grade realigns after an extra word", inserted.ok === 3 && inserted.words[1].status === "extra");
ok("strict umlaut aliases preserve case", gradeText(["Äpfel"], ["Aepfel"], STRICT).ok === 1 &&
  gradeText(["Äpfel"], ["aepfel"], STRICT).ok === 0);
const g4 = gradeText(["Guten"], ["Guten", "extra"]);
ok("grade extra", g4.extra === 1);
const g5 = gradeText(["HALLO"], ["hallo"], DEF_OPTS);
ok("grade relaxed case", g5.ok === 1);
const g6 = gradeText(["HALLO"], ["hallo"], STRICT);
ok("grade strict case", g6.ok === 0);

// ---- typing correction: ignore > < -, keep , . ----
ok("junk stripped", normalize(">Krauthausen") === "krauthausen");
ok("hyphen stripped", normalize("face-to-face") === "facetoface");
ok("default strips sentence punct", normalize("face<.") === "face");
ok("typing keeps period", gradeText(["Hallo."], ["Hallo."]).ok === 1);
ok("typing period omission = typo", gradeText(["Hallo."], ["Hallo"]).words[0].status === "typo");
ok("typing keeps comma", gradeText(["Herzlich,"], ["Herzlich"]).words[0].status === "typo");
ok("junk token alignment", gradeText([">Krauthausen", "-", "face"], ["Krauthausen", "face"]).ok === 2);
ok("tidy keeps sentence punct", tidy("von >Krauthausen - face to face<.") === "von Krauthausen face to face.");

// ---- matchCues ----
const sample = [
  { start: 0, dur: 2, text: "Ich habe ein Haus", words: [
    { start: 0, text: "Ich" }, { start: 0.3, text: "habe" },
    { start: 0.6, text: "ein" }, { start: 0.9, text: "Haus" },
  ]},
  { start: 3, dur: 2, text: "Das Haus ist groß", words: [
    { start: 3, text: "Das" }, { start: 3.3, text: "Haus" },
    { start: 3.6, text: "ist" }, { start: 3.9, text: "groß" },
  ]},
];
ok("match exact token", matchCues(sample, "haus").length === 2);
ok("match substring len4", matchCues(sample, "hauss").length === 0);
ok("match compound", matchCues([{ start:0, dur:1, text:"Hausschuhe", words:[{start:0,text:"Hausschuhe"}]}], "schuh").length === 1);
ok("match phrase", matchCues(sample, "ist groß").length === 1);
ok("match none", matchCues(sample, "xyzzy").length === 0);

// ---- matchSpoken ----
const m = matchSpoken(["Guten", "Tag"], ["Guten", "Tag"]);
ok("spoken perfect", m.ratio === 1);
const m2 = matchSpoken(["Guten", "Tag"], ["Guten"]);
ok("spoken missing", m2.ratio === 0.5 && m2.words[1].status === "missed");
const m3 = matchSpoken(["Hallo"], ["Hollo"]);
ok("spoken fuzzy >=0.8 counts", m3.words[0].status !== "missed");
const m4 = matchSpoken(["Hallo", "Welt"], ["Welt", "Hallo"]);
ok("spoken order-insensitive", m4.ratio === 1);

// ---- splitSegments ----
const many = Array.from({ length: 40 }, (_, i) => ({ start: i * 4, dur: 3.5, text: "x", words: [{ start: i * 4, text: "x" }] }));
const segs = splitSegments(many);
ok("segs non-empty", segs.length >= 1);
ok("segs cover all cues", segs[segs.length - 1].ci1 === 39);
ok("segs contiguous", segs.every((s, i) => i === 0 || s.ci0 === segs[i - 1].ci1 + 1));
ok("segs max 16", splitSegments(many, 16, 1).length <= 16);
ok("empty cues -> empty segs", splitSegments([]).length === 0);

// ---- chunkWords ----
const W = (n) => Array.from({ length: n }, (_, i) => ({ text: "w" + i }));
ok("limit 0 = whole line", chunkWords(W(20), 0).length === 1);
ok("limit 5", chunkWords(W(12), 5).length === 3);
ok("limit 7 parts fit", chunkWords(W(15), 7).every((p) => p.length <= 7));
ok("short line stays whole", chunkWords(W(3), 5).length === 1);
ok("empty words", chunkWords([], 5).length === 1 && chunkWords([], 5)[0].length === 0);

// ---- chunkTimeRange ----
// lead 0.2 / trail 0.3 pad: from ≤ word start, to ≥ next word start, both clamped to cue
const cw = (s, t) => ({ start: s, text: t });
const c0 = { start: 0, dur: 2, words: [cw(0, "a"), cw(0.3, "b"), cw(0.6, "c"), cw(0.9, "d")] };
const rMid = chunkTimeRange(c0, c0.words.slice(0, 2));
ok("chunk range mid: from at/before first word", rMid.from <= 0.01 && rMid.from >= -0.01);
ok("chunk range mid: to at/after next word", rMid.to >= 0.6 - 0.01 && rMid.to <= 0.6 + 0.31);
const rLast = chunkTimeRange(c0, c0.words.slice(2));
ok("chunk range last: to cue end", Math.abs(rLast.to - 2) < 0.01);
ok("chunk range last: from at/before word", rLast.from <= 0.6 + 0.01 && rLast.from >= 0.6 - 0.21);
ok("chunk range empty", chunkTimeRange(c0, []) === null);
ok("chunk range whole line", chunkTimeRange(c0, c0.words).from <= 0.01);
// ASR-style: every word shares one start time → spread across cue
const cA = { start: 5, dur: 6, words: Array.from({ length: 10 }, (_, i) => cw(5, "w" + i)) };
const rD = chunkTimeRange(cA, cA.words.slice(0, 5));
ok("degenerate: half cue = 5/10 words", rD.from <= 5.01 && rD.to >= 8 - 0.01 && rD.to <= 8 + 0.31);
ok("degenerate: min span", rD.to - rD.from >= 0.3);
const rD2 = chunkTimeRange(cA, cA.words.slice(5));
ok("degenerate: second half → cue end", rD2.from <= 8.01 && rD2.from >= 8 - 0.21 && Math.abs(rD2.to - 11) < 0.01);
ok("degenerate: clamped to cue", rD2.to <= 11.001 && rD2.from >= 5);
// mid-segment: 3 words share t=0, 2 share t=2 — chunk starting at word 1 must not include word 0
const cM = { start: 0, dur: 4, words: [cw(0, "aaa"), cw(0, "bb"), cw(0, "c"), cw(2, "ddd"), cw(2, "ee")] };
const rM = chunkTimeRange(cM, cM.words.slice(1, 3)); // bb, c
ok("mid-seg: from after word 0 (padded)", rM.from > 0.3 && rM.from < 1.5);
ok("mid-seg: to covers next seg (padded)", rM.to >= 2.0 - 0.01 && rM.to <= 2.0 + 0.31);
const rM0 = chunkTimeRange(cM, cM.words.slice(0, 2)); // aaa, bb
ok("mid-seg: first chunk starts at seg head", rM0.from <= 0.01 && rM0.from >= -0.01);
ok("mid-seg: first chunk ends at/after c (padded)", rM0.to > 1.5 && rM0.to <= 2.0 + 0.31);
// junk token between typeable words: zero-width, adjacent chunks overlap (no gap)
const cJ = { start: 10, dur: 7, words: [
  cw(10, "tun."), cw(10, "Der"), cw(10, "Ausstoß"),
  cw(10, "—"),
  cw(10, "und"), cw(10, "das"), cw(10, "Urteil"),
] };
const fJ = cJ.words.filter((w) => normalize(w.text));
const pJ = [fJ.slice(0, 3), fJ.slice(3)];
const rJ0 = chunkTimeRange(cJ, pJ[0]);
const rJ1 = chunkTimeRange(cJ, pJ[1]);
ok("junk: no gap between chunks", rJ1.from <= rJ0.to + 0.01);
ok("junk: first chunk covers from cue start", rJ0.from <= 10.01);
ok("junk: last chunk reaches cue end", Math.abs(rJ1.to - 17) < 0.01);

// ---- pickVideoRow ----
const mkRow = (id, ci) => ({ p: { id }, ci, time: 0, wi: [0] });
const multi = [mkRow("v1", 0), mkRow("v1", 1), mkRow("v2", 0), mkRow("v3", 0)];
const pr = pickVideoRow(multi);
ok("pickVideoRow non-null", !!pr && ["v1", "v2", "v3"].includes(pr.p.id));
ok("pickVideoRow empty", pickVideoRow([]) === null);
const seenVids = new Set();
for (let i = 0; i < 40; i++) seenVids.add(pickVideoRow(multi).p.id);
ok("pickVideoRow covers multiple videos", seenVids.size >= 2);
ok("pickVideoRow avoids last vid", pickVideoRow(multi, "v1").p.id !== "v1");
ok("pickVideoRow falls back when only one vid", pickVideoRow([mkRow("v1", 0)], "v1").p.id === "v1");

// ---- ygStartIndex: same word re-roll → different clip ----
const ygList = [{ vid: "a" }, { vid: "b" }, { vid: "c" }];
ok("ygStart first time", ygStartIndex(ygList, "") === 0);
ok("ygStart avoids last", ygStartIndex(ygList, "a") !== 0);
ok("ygStart avoids last (any alt)", ["b", "c"].includes(ygList[ygStartIndex(ygList, "a")].vid));
ok("ygStart single result", ygStartIndex([{ vid: "a" }], "a") === 0);
ok("ygStart avoid not in list", ygStartIndex(ygList, "zz") === 0);

// ---- findCueByText ----
ok("find exact", findCueByText(sample, "Das Haus ist groß") === 1);
ok("find partial", findCueByText(sample, "ein Haus") === 0);
ok("find miss", findCueByText(sample, "nicht da") === -1);
ok("find strips markers", findCueByText(sample, "[[[Haus]]]") >= 0);

// ---- store / SRS ----
const t0 = Date.now();
const before = loadWords().length;
const e = markWord({ w: "Testwort", v: "vid123", t: 1.5, ctx: "ctx" }, "fail");
ok("fail enqueues", loadWords().length === before + 1 || loadWords().some((x) => x.w === "Testwort"));
const e2 = markWord({ w: "Testwort", v: "vid123", t: 1.5, ctx: "ctx2" }, "pass");
ok("pass bumps seen", e2 && e2.seen >= 1);
ok("pass schedules future", e2 && e2.due > t0 + 86400000 - 1000);
const due = dueWords([{ w: "x", v: "v", t: 0, due: Date.now() - 1000 }]);
ok("due past", due.length === 1);
const notDue = dueWords([{ w: "x", v: "v", t: 0, due: Date.now() + 86400000 * 3 }]);
ok("not due future", notDue.length === 0);
ok("interval grows", intervalDays(1) < intervalDays(3) && intervalDays(10) <= 30);
const s1 = streakNext(null, 0, "2026-01-01");
ok("streak starts", s1.streak === 1);
const s2 = streakNext("2026-01-01", 1, "2026-01-02");
ok("streak continues", s2.streak === 2);
const s3 = streakNext("2026-01-01", 1, "2026-01-05");
ok("streak resets", s3.streak === 1);
const s4 = streakNext("2026-01-01", 5, "2026-01-01");
ok("streak same day", s4.streak === 5);

// ---- YouGlish search page parse ----
const ygPage = "<html><p>params.jsonData = '{\\\"total_results\\\":\\\"8814\\\",\\\"altered_query\\\":\\\"kaufen\\\",\\\"results\\\":[{\\\"display\\\":\\\"Ich kaufe Brot\\\\\\\" hier.\\\",\\\"vid\\\":\\\"-q0Sm8Kldn0\\\",\\\"start\\\":\\\"44\\\",\\\"end\\\":\\\"46\\\"},{\\\"display\\\":\\\"andere\\\",\\\"vid\\\":\\\"abc_123\\\",\\\"start\\\":\\\"7\\\"}]}';</p></html>";
const yg = parseYgResults(ygPage);
ok("yg results count", yg.results.length === 2);
ok("yg vid", yg.results[0].vid === "-q0Sm8Kldn0");
ok("yg start", yg.results[0].start === "44");
ok("yg inner escapes", yg.results[0].display.includes('" hier.'));
ok("yg total", yg.total_results === "8814");
let ygErr = "";
try { parseYgResults("<html>daily search quota exceeded, upgrade to Premium</html>"); } catch (ex) { ygErr = ex.message; }
ok("yg quota message", /quota/i.test(ygErr));
let ygErr2 = "";
try { parseYgResults("<html>no data here</html>"); } catch (ex) { ygErr2 = ex.message; }
ok("yg no-json error", ygErr2.length > 0 && !/quota/i.test(ygErr2));
let ygErr3 = "";
try { parseYgResults("<html><title>Bot detection!</title></html>"); } catch (ex) { ygErr3 = ex.message; }
ok("yg bot message", /blocked/i.test(ygErr3));

// ---- B1 word pool ----
ok("B1 size", B1_WORDS.length >= 500);
ok(
  "B1 no articles/junk",
  B1_WORDS.every(
    (w) =>
      typeof w === "string" &&
      w === w.trim() &&
      w.length >= 2 &&
      !/^(der|die|das)\b/i.test(w) &&
      !/[*,"\\]/.test(w) &&
      !/^\d/.test(w)
  )
);
ok("B1 has sample words", B1_WORDS.includes("heißen") && B1_WORDS.includes("Menschenrecht"));

// cleanup test word
saveWords(loadWords().filter((x) => x.w !== "Testwort"));

const relayUrl = (target) => "http://localhost/api/relay?u=" + encodeURIComponent(target);
assert.equal((await relay(new Request(relayUrl("https://www.youtube.com/account")))).status, 403);
assert.equal((await relay(new Request(relayUrl("https://www.youtube.com/youtubei/v1/player"), {
  method: "POST", body: "x".repeat(65537),
}))).status, 413);
const networkFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1));
  assert.equal((await relay(new Request(relayUrl("https://www.youtube.com/watch?v=abcdefghijk")))).status, 502);
} finally {
  globalThis.fetch = networkFetch;
}

storage.set("klTheme", "white");
const pack = { id: "abcdefghijk", cues: [{ start: 0, dur: 1, text: "Hallo", words: [{ start: 0, text: "Hallo" }] }] };
await assert.rejects(importAll({
  app: "klanger", localStorage: { klTheme: "dark" },
  packs: [pack, { id: "invalid" }],
}), /Invalid backup clips/);
assert.equal(storage.get("klTheme"), "white");
globalThis.indexedDB = {
  open() {
    const request = { error: new Error("simulated database failure") };
    queueMicrotask(() => request.onerror());
    return request;
  },
};
await assert.rejects(importAll({
  app: "klanger", localStorage: { klTheme: "dark", klTypingStyle: "line" }, packs: [pack],
}), /simulated database failure/);
assert.equal(storage.get("klTheme"), "white");
assert.equal(storage.has("klTypingStyle"), false);

console.log("All self-checks passed");
