// klanger — VocaType Video catalog (same public Supabase the site ships in its JS).
// Publishable key is client-side by design; read-only catalog queries only.

const BASE = "https://tfjntmltuexcjvjlhpww.supabase.co/rest/v1";
const KEY = "sb_publishable_cA5S-GUZhkKWB1F5XpL-3Q_OeTXi0O3";

const headers = { apikey: KEY, Accept: "application/json" };

async function get(path) {
  const res = await fetch(BASE + path, { headers });
  if (!res.ok) throw new Error("catalog HTTP " + res.status);
  return res.json();
}

// German videos that have captions. ponytail: simple limit, no pagination until needed.
export async function listGermanVideos(limit = 30) {
  return get(
    "/videos?select=id,youtube_id,title,channel_name,duration_seconds,thumbnail_url,has_captions" +
    "&source_lang=eq.de&has_captions=eq.true&order=created_at.desc&limit=" + limit
  );
}

// Curated sample reel (VocaType's onboarding list) filtered to German when present.
export async function listSamples(limit = 20) {
  try {
    const rows = await get(
      "/videos?select=id,youtube_id,title,channel_name,duration_seconds,thumbnail_url,has_captions,source_lang" +
      "&is_sample=eq.true&order=sample_order.asc&limit=" + limit
    );
    return rows;
  } catch { return []; }
}

// Map to the shape the UI wants.
export function toCard(v) {
  return {
    id: v.youtube_id,
    title: v.title || "Untitled",
    channel: v.channel_name || "",
    duration: v.duration_seconds || 0,
    thumb: v.thumbnail_url || (v.youtube_id ? "https://i.ytimg.com/vi/" + v.youtube_id + "/hqdefault.jpg" : ""),
    hasCaptions: !!v.has_captions,
    lang: v.source_lang || "",
  };
}
