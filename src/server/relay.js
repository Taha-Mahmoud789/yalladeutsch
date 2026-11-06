const YOUTUBE = new Set(["www.youtube.com", "youtube.com"]);
const YOUGLISH = new Set(["youglish.com", "www.youglish.com"]);
const YOUTUBE_GET = new Set(["/watch", "/oembed", "/results", "/api/timedtext"]);
const MAX_REQUEST = 64 * 1024;
const MAX_RESPONSE = 8 * 1024 * 1024;

class PayloadTooLarge extends Error {}

async function readLimited(stream, limit) {
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new PayloadTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function relay(request) {
  if (!["GET", "POST", "OPTIONS"].includes(request.method)) {
    return new Response("method not allowed", { status: 405 });
  }
  const signal = AbortSignal.timeout(7000);
  if (request.method === "OPTIONS") { return new Response(null, { status: 204 }); }
  try {
    let target;
    try {
      target = new URL(new URL(request.url).searchParams.get("u"));
    } catch {
      return new Response("bad target url", { status: 400 });
    }
    const isYg = YOUGLISH.has(target.hostname);
    const isYouTube = YOUTUBE.has(target.hostname);
    const allowed = request.method === "POST"
      ? isYouTube && target.pathname === "/youtubei/v1/player"
      : (isYg && /^\/pronounce\/[^/]+\/german\/?$/.test(target.pathname)) ||
        (isYouTube && (YOUTUBE_GET.has(target.pathname) || /^\/@[^/]+\/videos$/.test(target.pathname)));
    if (target.protocol !== "https:" || target.port || target.username || target.password || !allowed) {
      return new Response("destination not allowed", { status: 403 });
    }
    let body;
    if (request.method === "POST") {
      try {
        body = await readLimited(request.body, MAX_REQUEST);
      } catch (error) {
        if (error instanceof PayloadTooLarge) return new Response("request too large", { status: 413 });
        throw error;
      }
    }
    const out = await fetch(target.href, {
      method: request.method,
      redirect: "error",
      signal,
      headers: {
        // YouGlish bot-checks the Android UA; browser UA still sometimes trips
        // it — fall back to jina raw HTML below when that happens.
        "User-Agent": isYg
          ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
          : "com.google.android.youtube/20.10.38 (Windows NT; heise) gzip",
        "Accept-Language": "de,en;q=0.7",
        ...(isYg ? { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } : {}),
        ...(request.headers.get("content-type") ? { "Content-Type": request.headers.get("content-type") } : {}),
      },
      body,
    });
    let status = out.status;
    let ct = out.headers.get("content-type") || "application/octet-stream";
    let buf = await readLimited(out.body, MAX_RESPONSE);
    // Direct fetch often gets a bot-challenge page (HTTP 200, no jsonData).
    // Server-side jina with x-respond-with:html bypasses it (no CORS here).
    if (isYg && /Bot detection|captcha/i.test(buf.toString("utf8"))) {
      try {
        const alt = await fetch("https://r.jina.ai/" + target.href, {
          redirect: "error",
          signal,
          headers: {
            "x-respond-with": "html",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          },
        });
        if (alt.ok) {
          const altBuf = await readLimited(alt.body, MAX_RESPONSE);
          if (/params\.jsonData/.test(altBuf.toString("utf8"))) {
            buf = altBuf;
            status = 200;
            ct = "text/html; charset=utf-8";
          }
        }
      } catch { /* keep bot page; client drops it */ }
    }
    return new Response([204, 205, 304].includes(status) ? null : buf, {
      status,
      headers: { "Content-Type": ct, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" },
    });
  } catch {
    return new Response("upstream request failed", { status: 502 });
  }
}
