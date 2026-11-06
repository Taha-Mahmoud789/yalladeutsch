import { dbAll } from "../data/db.js";
import { loadWords, dueWords, removeWord, streakNext, fmtDay } from "../data/store.js";
import { $, esc, toast } from "./dom.js";

export function bumpStats(kind) {
  const s = (() => { try { return JSON.parse(localStorage.getItem("klStats") || "{}"); } catch { return {}; } })();
  const today = fmtDay();
  const r = streakNext(s.lastDay, s.streak || 0, today);
  s.streak = r.streak;
  s.lastDay = today;
  if (kind === "dictation") s.sentences = (s.sentences || 0) + 1;
  else s.attempts = (s.attempts || 0) + 1;
  localStorage.setItem("klStats", JSON.stringify(s));
  statsLine();
}

export function statsLine() {
  const s = (() => { try { return JSON.parse(localStorage.getItem("klStats") || "{}"); } catch { return {}; } })();
  const words = loadWords();
  const due = dueWords(words).length;
  $("stats-line").textContent =
    "Streak " + (s.streak || 0) + " d · lines dictated " + (s.sentences || 0) +
    " · spoken reps " + (s.attempts || 0) +
    " · problem words " + words.length + " (due now: " + due + ")";
  $("streak-chip").textContent = s.streak ? "🔥 " + s.streak + "-day streak" : "";
}

export async function renderDue(openTrainer) {
  const due = dueWords();
  const box = $("q-results");
  box.innerHTML = "";
  const head = document.createElement("p");
  head.className = "hint";
  head.textContent = due.length
    ? due.length + " word(s) due — practicing the sentence moves it forward; a miss brings it back tomorrow:"
    : "Nothing due right now. Later, or after more practice.";
  box.appendChild(head);
  const packs = await dbAll().catch(() => []);
  const packMap = Object.fromEntries(packs.map((p) => [p.id, p]));
  for (const entry of due.slice(0, 30)) {
    const row = document.createElement("div");
    row.className = "q-result";
    const p = packMap[entry.v];
    const ci = p ? p.cues.findIndex((c) => Math.abs(c.start - entry.t) < 2.5) : -1;
    row.innerHTML =
      "<b>" + esc(entry.w) + "</b><i>" + (p ? esc(p.channel || p.title) : "not in corpus") +
      "</i><span>" + esc(entry.ctx || "") + "</span>";
    const go = document.createElement("button");
    go.className = "btn ghost mini";
    go.type = "button";
    go.textContent = "Practice";
    go.addEventListener("click", () => {
      if (!p || ci < 0) return toast("That video isn't indexed — open it by URL once");
      openTrainer(entry.v, p.cues, p.src, { ci, time: p.cues[ci].start, needle: entry.w, dictate: true });
    });
    const x = document.createElement("button");
    x.className = "btn ghost mini";
    x.type = "button";
    x.textContent = "✕";
    x.title = "Remove from queue";
    x.addEventListener("click", () => { removeWord(entry); row.remove(); statsLine(); });
    row.append(go, x);
    box.appendChild(row);
  }
}
