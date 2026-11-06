// klanger — weak-word SRS + streak math + whole-app backup.
// Only misses enter the queue; passes extend due date.
// Ladder: fail -> tomorrow; pass streak k -> 2^k days, capped at a month.

import { dbAll, dbPutAll } from "./db.js";

const KEY = "klWords";

export function loadWords() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function saveWords(arr) {
  localStorage.setItem(KEY, JSON.stringify(arr.slice(-400))); // ponytail: 400-word cap
}
export function intervalDays(seen) {
  return Math.min(30, Math.pow(2, Math.max(1, seen)));
}
export function dayNum(s) {
  return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
}
export function fmtDay(d = new Date()) {
  const p = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
export function streakNext(lastDay, streak, today) {
  if (!lastDay) return { lastDay: today, streak: 1 };
  const diff = dayNum(today) - dayNum(lastDay);
  return { lastDay: today, streak: diff === 0 ? streak : diff === 1 ? streak + 1 : 1 };
}

export function markWord(meta, outcome) {
  const arr = loadWords();
  const t = +(meta.t || 0).toFixed(1);
  let e = arr.find((x) => x.w === meta.w && x.v === meta.v);
  if (!e) {
    if (outcome !== "fail") return;
    e = { w: meta.w, v: meta.v, t, ctx: meta.ctx || "", seen: 0, due: 0 };
    arr.push(e);
  } else {
    e.ctx = meta.ctx || e.ctx;
  }
  e.seen = outcome === "pass" ? Math.max(1, (e.seen || 0) + 1) : 0;
  e.due = Date.now() + (e.seen ? intervalDays(e.seen) : 1) * 86400000;
  e.last = Date.now();
  saveWords(arr);
  return e;
}

export function dueWords(arr = loadWords()) {
  const now = Date.now();
  return arr.filter((e) => (e.due || 0) <= now + 3600000);
}

export function removeWord(e) {
  saveWords(loadWords().filter((x) => !(x.w === e.w && x.v === e.v)));
}

export async function exportAll() {
  const lv = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("kl")) lv[k] = localStorage.getItem(k);
  }
  return { app: "klanger", ts: Date.now(), localStorage: lv, packs: await dbAll() };
}

export async function importAll(data) {
  if (!data || data.app !== "klanger") throw new Error("not a klanger backup file");
  const packs = data.packs ?? [];
  const settings = data.localStorage ?? {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Invalid backup settings");
  }
  const validTime = (value) => Number.isFinite(value) && value >= 0;
  if (!Array.isArray(packs) || packs.some((pack) =>
    !pack || typeof pack.id !== "string" || !pack.id ||
    !Array.isArray(pack.cues) || pack.cues.some((cue) =>
      !cue || !validTime(cue.start) || !validTime(cue.dur) || typeof cue.text !== "string" ||
      !Array.isArray(cue.words) || cue.words.some((word) =>
        !word || !validTime(word.start) || typeof word.text !== "string")))) {
    throw new Error("Invalid backup clips");
  }
  const entries = Object.entries(settings).filter(([key]) => key.startsWith("kl"));
  for (const [key, value] of entries) {
    if (typeof value !== "string") throw new Error("Invalid backup setting: " + key);
    if (key === KEY) {
      const words = JSON.parse(value);
      if (!Array.isArray(words) || words.some((word) =>
        !word || typeof word.w !== "string" || typeof word.v !== "string" || !validTime(word.t))) {
        throw new Error("Invalid review words");
      }
    } else if (key === "klStats" || key === "klBests") {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Invalid backup setting: " + key);
      }
    }
  }
  const original = new Map(entries.map(([key]) => [key, localStorage.getItem(key)]));
  const written = [];
  try {
    for (const [key, value] of entries) {
      localStorage.setItem(key, value);
      written.push([key, value]);
    }
    await dbPutAll(packs);
  } catch (error) {
    for (const [key, value] of written.reverse()) {
      if (localStorage.getItem(key) !== value) continue;
      const previous = original.get(key);
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    }
    throw error;
  }
}
