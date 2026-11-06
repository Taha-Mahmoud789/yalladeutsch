// klanger caption relay — deploy once on Cloudflare Workers (free plan):
//   1. workers.dev dashboard -> Create Worker -> paste this file -> Deploy
//   2. copy the https://<name>.<account>.workers.dev URL
//   3. paste that URL into klanger home > "Caption relay" box (saved in localStorage)
// Generic CORS relay: pass ?u=<target-url>, forwards method+body.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const target = new URL(req.url).searchParams.get("u");
    if (!target || !/^https?:\/\//.test(target)) {
      return new Response("?u=<encoded url> required", { status: 400, headers: CORS });
    }
    const res = await fetch(target, {
      method: req.method,
      headers: {
        "Content-Type": req.headers.get("Content-Type") || "application/json",
        "User-Agent": req.headers.get("User-Agent") || "Mozilla/5.0",
      },
      body: req.method === "GET" ? undefined : await req.text(),
    });
    let out = res;
    // YouGlish bot-challenges direct fetches; jina raw HTML still has params.jsonData.
    if (/youglish\.com$/i.test(new URL(target).hostname)) {
      const direct = await res.clone().text();
      if (/Bot detection|captcha/i.test(direct)) {
        try {
          const alt = await fetch("https://r.jina.ai/" + target, {
            headers: { "x-respond-with": "html", "User-Agent": "Mozilla/5.0" },
          });
          if (alt.ok && /params\.jsonData/.test(await alt.clone().text())) out = alt;
        } catch { /* keep direct */ }
      }
    }
    const headers = new Headers(out.headers);
    for (const k of Object.keys(CORS)) headers.set(k, CORS[k]);
    return new Response(out.body, { status: out.status, headers });
  },
};
