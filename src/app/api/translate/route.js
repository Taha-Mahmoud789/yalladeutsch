export async function GET(request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || new TextEncoder().encode(query).length > 500) {
    return Response.json({ error: "Enter a short German word or phrase." }, { status: 400 });
  }

  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", query);
  url.searchParams.set("langpair", "de|ar");

  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(6500), cache: "no-store" });
    const result = await upstream.json();
    if (upstream.status === 429 || Number(result.responseStatus) === 429) {
      return Response.json({ error: "The translation service has reached its limit. Try again later." }, { status: 429 });
    }
    const hasArabic = (value) => typeof value === "string" && /\p{Script=Arabic}/u.test(value);
    const term = query.toLocaleLowerCase("de");
    const dictionaryMatch = !/\s/.test(term) && Array.isArray(result.matches)
      ? result.matches.find(({ segment, translation }) =>
          typeof segment === "string" && ["der", "die", "das"].some((article) =>
            segment.toLocaleLowerCase("de") === term + ", " + article) && hasArabic(translation))
      : null;
    const translation = dictionaryMatch?.translation ?? result.responseData?.translatedText;
    if (upstream.ok && Number(result.responseStatus) === 200 && typeof translation === "string" &&
        /\p{Script=Arabic}/u.test(translation)) {
      return Response.json({ translation });
    }
    if (upstream.ok && Number(result.responseStatus) === 200) {
      return Response.json({ error: "No Arabic translation found. Try adding context." }, { status: 404 });
    }
  } catch {
    // Network failures and invalid upstream responses share a retry message.
  }
  return Response.json({ error: "Translation is temporarily unavailable. Try again." }, { status: 502 });
}
