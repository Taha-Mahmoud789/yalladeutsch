export const $ = (id) => document.getElementById(id);

let toastT = 0;
export function toast(msg, ms = 2800) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("show"), ms);
}

export const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
export function esc(t) {
  const d = document.createElement("span");
  d.textContent = t;
  return d.innerHTML;
}

